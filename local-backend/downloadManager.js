const fs = require('fs');
const http = require('http');
const https = require('https');
const {
    deriveLocalPath,
    ensureParentDirectory,
    derivePartialPath,
    finalizePartialDownload
} = require('./fileUtils');

const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 30000;
const PROGRESS_UPDATE_INTERVAL_MS = 500;
const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);
const activeDownloads = new Map();

const createDownloadError = (message, code = null) => {
    const error = new Error(message);
    error.isCustomStremioDownloadError = true;
    error.code = code;
    return error;
};

const isSupportedSourceUrl = (sourceUrl) => {
    try {
        const parsedUrl = new URL(sourceUrl);
        return SUPPORTED_PROTOCOLS.has(parsedUrl.protocol);
    } catch {
        return false;
    }
};

const parseContentLength = (headerValue) => {
    const parsedValue = Number(headerValue);
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null;
};

const parseContentRange = (headerValue) => {
    if (typeof headerValue !== 'string') {
        return null;
    }

    const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(headerValue.trim());
    if (!match) {
        return null;
    }

    const start = Number(match[1]);
    const end = Number(match[2]);
    const total = match[3] === '*' ? null : Number(match[3]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
        return null;
    }
    if (total !== null && (!Number.isSafeInteger(total) || total <= end)) {
        return null;
    }

    return { start, end, total };
};

const parseUnsatisfiedContentRange = (headerValue) => {
    if (typeof headerValue !== 'string') {
        return null;
    }

    const match = /^bytes\s+\*\/(\d+)$/i.exec(headerValue.trim());
    const total = match ? Number(match[1]) : null;
    return Number.isSafeInteger(total) && total >= 0 ? total : null;
};

const normalizeDownloadError = (error) => {
    if (!error) {
        return createDownloadError('Download failed');
    }

    if (error.isCustomStremioDownloadError) {
        return error;
    }

    if (error.code === 'ECONNRESET') {
        return createDownloadError('Download connection was interrupted', error.code);
    }

    if (error.code === 'ETIMEDOUT') {
        return createDownloadError('Download request timed out', error.code);
    }

    return createDownloadError(error.message || 'Download failed', error.code || null);
};

const isRedirectStatusCode = (statusCode) => [301, 302, 303, 307, 308].includes(statusCode);

const getResumeValidator = ({ sourceEtag, sourceLastModified }) => {
    if (typeof sourceEtag === 'string' && sourceEtag.length > 0 && !sourceEtag.startsWith('W/')) {
        return sourceEtag;
    }
    return typeof sourceLastModified === 'string' && sourceLastModified.length > 0 ? sourceLastModified : null;
};

const buildProgressUpdate = ({
    bytesDownloaded,
    bytesTotal,
    startedAt,
    initialBytesDownloaded = 0,
    localPath,
    partialPath,
    forceCompleted = false
}) => {
    const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
    const sessionBytesDownloaded = Math.max(0, bytesDownloaded - initialBytesDownloaded);
    const speedBytesPerSecond = Math.max(0, Math.round(sessionBytesDownloaded / elapsedSeconds));
    const progress = bytesTotal !== null && bytesTotal > 0 ?
        Math.min(100, Number(((bytesDownloaded / bytesTotal) * 100).toFixed(2)))
        :
        (forceCompleted ? 100 : 0);
    const etaSeconds = bytesTotal !== null && speedBytesPerSecond > 0 ?
        Math.max(0, Math.round((bytesTotal - bytesDownloaded) / speedBytesPerSecond))
        :
        null;

    return {
        localPath,
        partialPath,
        bytesDownloaded,
        bytesTotal,
        progress,
        speedBytesPerSecond,
        etaSeconds
    };
};

const requestDownload = (sourceUrl, partialPath, control, redirectCount, resumeOffset, resumeValidator, onProgress) => {
    return new Promise((resolve, reject) => {
        if (!isSupportedSourceUrl(sourceUrl)) {
            reject(createDownloadError('Unsupported source URL protocol. Only http and https are supported.'));
            return;
        }

        const parsedUrl = new URL(sourceUrl);
        const requestModule = parsedUrl.protocol === 'https:' ? https : http;
        const headers = resumeOffset > 0 ? {
            Range: `bytes=${resumeOffset}-`,
            ...(resumeValidator ? { 'If-Range': resumeValidator } : {})
        } : {};
        let settled = false;

        const settle = (handler) => (value) => {
            if (settled) {
                return;
            }

            settled = true;
            handler(value);
        };

        const resolveOnce = settle(resolve);
        const rejectOnce = settle(reject);
        const request = requestModule.get(parsedUrl, { headers }, (response) => {
            control.request = request;
            control.response = response;

            if (isRedirectStatusCode(response.statusCode) && response.headers.location) {
                response.resume();
                if (redirectCount >= MAX_REDIRECTS) {
                    rejectOnce(createDownloadError('Too many redirects while downloading file'));
                    return;
                }

                resolveOnce({ redirectTo: new URL(response.headers.location, parsedUrl).toString() });
                return;
            }

            if (resumeOffset > 0 && response.statusCode === 416) {
                const completeLength = parseUnsatisfiedContentRange(response.headers['content-range']);
                response.resume();
                if (completeLength === resumeOffset) {
                    resolveOnce({
                        completed: true,
                        alreadyComplete: true,
                        bytesDownloaded: resumeOffset,
                        bytesTotal: completeLength,
                        startedAt: Date.now(),
                        initialBytesDownloaded: resumeOffset,
                        resumeSupported: true,
                        sourceEtag: control.sourceEtag,
                        sourceLastModified: control.sourceLastModified
                    });
                } else {
                    rejectOnce(createDownloadError(
                        'The remote file no longer matches the saved partial download.',
                        'DOWNLOAD_RESUME_RANGE_INVALID'
                    ));
                }
                return;
            }

            if (resumeOffset > 0 && response.statusCode !== 206) {
                response.resume();
                rejectOnce(createDownloadError(
                    response.statusCode === 200 ?
                        'The download source does not support resuming. Retry the download from the beginning.'
                        :
                        `Resume request failed with HTTP ${response.statusCode || 'unknown'}`,
                    response.statusCode === 200 ? 'DOWNLOAD_RESUME_UNSUPPORTED' : 'DOWNLOAD_RESUME_REQUEST_FAILED'
                ));
                return;
            }

            if (resumeOffset === 0 && response.statusCode !== 200 && response.statusCode !== 206) {
                response.resume();
                rejectOnce(createDownloadError(`Download request failed with HTTP ${response.statusCode || 'unknown'}`));
                return;
            }

            const contentLength = parseContentLength(response.headers['content-length']);
            const contentRange = response.statusCode === 206 ? parseContentRange(response.headers['content-range']) : null;
            if (response.statusCode === 206) {
                const expectedOffset = resumeOffset;
                const rangeLength = contentRange ? contentRange.end - contentRange.start + 1 : null;
                if (!contentRange || contentRange.start !== expectedOffset || (contentLength !== null && contentLength !== rangeLength)) {
                    response.resume();
                    rejectOnce(createDownloadError(
                        'The download source returned an invalid byte range for resume.',
                        'DOWNLOAD_RESUME_RANGE_INVALID'
                    ));
                    return;
                }
            }

            const bytesTotal = contentRange?.total ?? (contentLength === null ? null : resumeOffset + contentLength);
            const startedAt = Date.now();
            let bytesDownloaded = resumeOffset;
            let lastProgressUpdateAt = 0;
            let streamFinished = false;
            const resumeSupported = response.statusCode === 206 || /(?:^|,)\s*bytes\s*(?:,|$)/i.test(response.headers['accept-ranges'] || '');
            const sourceEtag = typeof response.headers.etag === 'string' ? response.headers.etag : control.sourceEtag;
            const sourceLastModified = typeof response.headers['last-modified'] === 'string' ? response.headers['last-modified'] : control.sourceLastModified;

            control.bytesDownloaded = bytesDownloaded;
            control.bytesTotal = bytesTotal;
            control.startedAt = startedAt;
            control.initialBytesDownloaded = resumeOffset;
            control.resumeSupported = resumeSupported;
            control.sourceEtag = sourceEtag;
            control.sourceLastModified = sourceLastModified;

            const fileStream = fs.createWriteStream(partialPath, { flags: resumeOffset > 0 ? 'a' : 'w' });
            control.fileStream = fileStream;

            const emitProgress = (force = false) => {
                const now = Date.now();
                if (!force && now - lastProgressUpdateAt < PROGRESS_UPDATE_INTERVAL_MS) {
                    return;
                }

                lastProgressUpdateAt = now;
                onProgress(buildProgressUpdate({
                    bytesDownloaded,
                    bytesTotal,
                    startedAt,
                    initialBytesDownloaded: resumeOffset,
                    partialPath
                }));
            };

            response.on('data', (chunk) => {
                bytesDownloaded += chunk.length;
                control.bytesDownloaded = bytesDownloaded;
                emitProgress(false);
            });
            response.on('aborted', () => {
                fileStream.destroy();
                rejectOnce(createDownloadError('Download response was interrupted', 'ECONNRESET'));
            });
            response.on('error', (error) => {
                fileStream.destroy();
                rejectOnce(error);
            });
            fileStream.on('error', (error) => {
                response.destroy();
                rejectOnce(error);
            });
            fileStream.on('finish', () => {
                streamFinished = true;
                emitProgress(true);
            });
            fileStream.on('close', () => {
                if (!streamFinished) {
                    return;
                }

                const expectedResponseBytes = contentRange ?
                    contentRange.end - contentRange.start + 1
                    :
                    contentLength;
                const receivedResponseBytes = bytesDownloaded - resumeOffset;
                if (expectedResponseBytes !== null && receivedResponseBytes !== expectedResponseBytes) {
                    rejectOnce(createDownloadError(
                        `Download response contained ${receivedResponseBytes} of ${expectedResponseBytes} expected bytes`,
                        'DOWNLOAD_SIZE_MISMATCH'
                    ));
                    return;
                }

                resolveOnce({
                    completed: true,
                    bytesDownloaded,
                    bytesTotal,
                    startedAt,
                    initialBytesDownloaded: resumeOffset,
                    resumeSupported,
                    sourceEtag,
                    sourceLastModified
                });
            });

            response.pipe(fileStream);
        });

        control.request = request;

        request.setTimeout(REQUEST_TIMEOUT_MS, () => {
            request.destroy(createDownloadError('Download request timed out', 'ETIMEDOUT'));
        });

        request.on('error', rejectOnce);
    });
};

const startDownload = (record, onUpdate, { resumeOffset = 0 } = {}) => {
    if (!record || !record.id) {
        return Promise.reject(createDownloadError('Download record is missing an id'));
    }

    if (activeDownloads.has(record.id)) {
        return activeDownloads.get(record.id).completionPromise;
    }

    const control = {
        request: null,
        response: null,
        fileStream: null,
        stopReason: null,
        bytesDownloaded: resumeOffset,
        bytesTotal: Number(record.bytesTotal) > 0 ? Number(record.bytesTotal) : null,
        startedAt: Date.now(),
        initialBytesDownloaded: resumeOffset,
        resumeSupported: record.resumeSupported ?? null,
        sourceEtag: record.sourceEtag ?? null,
        sourceLastModified: record.sourceLastModified ?? null,
        completionPromise: null
    };

    const emitUpdate = (updates) => onUpdate(record.id, updates);

    control.completionPromise = (async () => {
        const localPath = deriveLocalPath(record);
        const partialPath = derivePartialPath(localPath);
        let currentSourceUrl = record.sourceUrl;
        let redirectCount = 0;
        let currentOffset = resumeOffset;

        try {
            await ensureParentDirectory(partialPath);
            if (currentOffset === 0) {
                await fs.promises.rm(partialPath, { force: true });
            }

            while (true) {
                if (control.stopReason) {
                    throw createDownloadError(`Download ${control.stopReason} requested`);
                }

                emitUpdate({
                    status: 'downloading',
                    localPath,
                    partialPath,
                    bytesDownloaded: currentOffset,
                    completedAt: null,
                    error: null
                });

                const outcome = await requestDownload(
                    currentSourceUrl,
                    partialPath,
                    control,
                    redirectCount,
                    currentOffset,
                    getResumeValidator(control),
                    (updates) => {
                        emitUpdate({
                            status: 'downloading',
                            ...updates,
                            localPath,
                            resumeSupported: control.resumeSupported,
                            sourceEtag: control.sourceEtag,
                            sourceLastModified: control.sourceLastModified,
                            error: null
                        });
                    }
                );

                if (outcome.redirectTo) {
                    currentSourceUrl = outcome.redirectTo;
                    redirectCount += 1;
                    continue;
                }

                if (outcome.bytesTotal !== null && outcome.bytesDownloaded < outcome.bytesTotal) {
                    currentOffset = outcome.bytesDownloaded;
                    continue;
                }

                if (outcome.bytesTotal !== null && outcome.bytesDownloaded > outcome.bytesTotal) {
                    throw createDownloadError(
                        `Download ended at ${outcome.bytesDownloaded} of ${outcome.bytesTotal} bytes`,
                        'DOWNLOAD_SIZE_MISMATCH'
                    );
                }

                await finalizePartialDownload(partialPath, localPath, outcome.bytesDownloaded);
                emitUpdate({
                    status: 'completed',
                    ...buildProgressUpdate({
                        bytesDownloaded: outcome.bytesDownloaded,
                        bytesTotal: outcome.bytesTotal,
                        startedAt: outcome.startedAt,
                        initialBytesDownloaded: outcome.initialBytesDownloaded,
                        localPath,
                        partialPath: null,
                        forceCompleted: true
                    }),
                    resumeSupported: outcome.resumeSupported,
                    sourceEtag: outcome.sourceEtag,
                    sourceLastModified: outcome.sourceLastModified,
                    completedAt: new Date().toISOString(),
                    error: null
                });
                return;
            }
        } catch (error) {
            const bytesDownloaded = Number.isFinite(control.bytesDownloaded) ? control.bytesDownloaded : resumeOffset;
            const bytesTotal = Number.isFinite(control.bytesTotal) ? control.bytesTotal : null;
            const progressUpdate = buildProgressUpdate({
                bytesDownloaded,
                bytesTotal,
                startedAt: control.startedAt,
                initialBytesDownloaded: control.initialBytesDownloaded,
                localPath,
                partialPath
            });

            if (control.stopReason) {
                emitUpdate({
                    status: control.stopReason === 'pause' ? 'paused' : 'canceled',
                    ...progressUpdate,
                    speedBytesPerSecond: 0,
                    etaSeconds: null,
                    resumeSupported: control.resumeSupported,
                    sourceEtag: control.sourceEtag,
                    sourceLastModified: control.sourceLastModified,
                    completedAt: null,
                    error: null
                });
                return;
            }

            const normalizedError = normalizeDownloadError(error);
            emitUpdate({
                status: 'failed',
                ...progressUpdate,
                speedBytesPerSecond: 0,
                etaSeconds: null,
                resumeSupported: normalizedError.code === 'DOWNLOAD_RESUME_UNSUPPORTED' ? false : control.resumeSupported,
                sourceEtag: control.sourceEtag,
                sourceLastModified: control.sourceLastModified,
                completedAt: null,
                error: normalizedError.message
            });
        } finally {
            activeDownloads.delete(record.id);
        }
    })();

    activeDownloads.set(record.id, control);
    return control.completionPromise;
};

const stopDownload = async (recordId, stopReason) => {
    const control = activeDownloads.get(recordId);
    if (!control) {
        return false;
    }

    control.stopReason = stopReason;
    const stopError = createDownloadError(stopReason === 'pause' ? 'Paused by user' : 'Canceled by user');

    if (control.request && !control.request.destroyed) {
        control.request.destroy(stopError);
    }
    if (control.response && !control.response.destroyed) {
        control.response.destroy(stopError);
    }
    if (control.fileStream && !control.fileStream.destroyed) {
        control.fileStream.destroy(stopError);
    }

    try {
        await control.completionPromise;
    } catch {
        // The completion promise normalizes pause/cancel state via onUpdate.
    }

    return true;
};

const pauseDownload = (recordId) => stopDownload(recordId, 'pause');
const cancelDownload = (recordId) => stopDownload(recordId, 'cancel');
const isDownloadActive = (recordId) => activeDownloads.has(recordId);

module.exports = {
    startDownload,
    pauseDownload,
    cancelDownload,
    isDownloadActive,
    isSupportedSourceUrl,
    parseContentRange,
    buildProgressUpdate
};

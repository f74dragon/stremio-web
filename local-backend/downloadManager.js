const fs = require('fs');
const http = require('http');
const https = require('https');
const { deriveLocalPath, ensureParentDirectory } = require('./fileUtils');

const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 30000;
const PROGRESS_UPDATE_INTERVAL_MS = 500;
const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);
const activeDownloads = new Map();

const createDownloadError = (message) => {
    const error = new Error(message);
    error.isCustomStremioDownloadError = true;
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

const normalizeDownloadError = (error) => {
    if (!error) {
        return createDownloadError('Download failed');
    }

    if (error.isCustomStremioDownloadError) {
        return error;
    }

    if (error.code === 'ECONNRESET') {
        return createDownloadError('Download connection was interrupted');
    }

    if (error.code === 'ETIMEDOUT') {
        return createDownloadError('Download request timed out');
    }

    return createDownloadError(error.message || 'Download failed');
};

const isRedirectStatusCode = (statusCode) => [301, 302, 303, 307, 308].includes(statusCode);

const buildProgressUpdate = ({ bytesDownloaded, bytesTotal, startedAt, localPath, forceCompleted = false }) => {
    const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
    const speedBytesPerSecond = Math.max(0, Math.round(bytesDownloaded / elapsedSeconds));
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
        bytesDownloaded,
        bytesTotal,
        progress,
        speedBytesPerSecond,
        etaSeconds
    };
};

const requestDownload = (sourceUrl, localPath, control, redirectCount, onProgress) => {
    return new Promise((resolve, reject) => {
        if (!isSupportedSourceUrl(sourceUrl)) {
            reject(createDownloadError('Unsupported source URL protocol. Only http and https are supported.'));
            return;
        }

        const parsedUrl = new URL(sourceUrl);
        const requestModule = parsedUrl.protocol === 'https:' ? https : http;
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

        const request = requestModule.get(parsedUrl, (response) => {
            control.request = request;
            control.response = response;

            if (isRedirectStatusCode(response.statusCode) && response.headers.location) {
                response.resume();
                if (redirectCount >= MAX_REDIRECTS) {
                    rejectOnce(createDownloadError('Too many redirects while downloading file'));
                    return;
                }

                resolveOnce({
                    redirectTo: new URL(response.headers.location, parsedUrl).toString()
                });
                return;
            }

            if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
                response.resume();
                rejectOnce(createDownloadError(`Download request failed with HTTP ${response.statusCode || 'unknown'}`));
                return;
            }

            const bytesTotal = parseContentLength(response.headers['content-length']);
            const startedAt = Date.now();
            let bytesDownloaded = 0;
            let lastProgressUpdateAt = 0;

            const fileStream = fs.createWriteStream(localPath);
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
                    localPath
                }));
            };

            response.on('data', (chunk) => {
                bytesDownloaded += chunk.length;
                emitProgress(false);
            });

            response.on('error', rejectOnce);
            fileStream.on('error', rejectOnce);

            fileStream.on('finish', () => {
                emitProgress(true);
                resolveOnce({
                    completed: true,
                    bytesDownloaded,
                    bytesTotal,
                    startedAt
                });
            });

            response.pipe(fileStream);
        });

        control.request = request;

        request.setTimeout(REQUEST_TIMEOUT_MS, () => {
            request.destroy(createDownloadError('Download request timed out'));
        });

        request.on('error', rejectOnce);
    });
};

const startDownload = (record, onUpdate) => {
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
        cancelRequested: false,
        completionPromise: null
    };

    const emitUpdate = (updates) => onUpdate(record.id, updates);

    control.completionPromise = (async () => {
        const localPath = deriveLocalPath(record);
        let currentSourceUrl = record.sourceUrl;
        let redirectCount = 0;

        try {
            await ensureParentDirectory(localPath);

            while (true) {
                if (control.cancelRequested) {
                    emitUpdate({
                        status: 'canceled',
                        localPath,
                        speedBytesPerSecond: 0,
                        etaSeconds: null,
                        error: null
                    });
                    return;
                }

                emitUpdate({
                    status: 'downloading',
                    localPath,
                    completedAt: null,
                    error: null
                });

                const outcome = await requestDownload(currentSourceUrl, localPath, control, redirectCount, (updates) => {
                    emitUpdate({
                        status: 'downloading',
                        ...updates,
                        error: null
                    });
                });

                if (outcome.redirectTo) {
                    currentSourceUrl = outcome.redirectTo;
                    redirectCount += 1;
                    continue;
                }

                emitUpdate({
                    status: 'completed',
                    localPath,
                    ...buildProgressUpdate({
                        bytesDownloaded: outcome.bytesDownloaded,
                        bytesTotal: outcome.bytesTotal,
                        startedAt: outcome.startedAt,
                        localPath,
                        forceCompleted: outcome.bytesTotal !== null
                    }),
                    completedAt: new Date().toISOString(),
                    error: null
                });
                return;
            }
        } catch (error) {
            if (control.cancelRequested) {
                emitUpdate({
                    status: 'canceled',
                    localPath,
                    speedBytesPerSecond: 0,
                    etaSeconds: null,
                    error: null
                });
                return;
            }

            const normalizedError = normalizeDownloadError(error);
            emitUpdate({
                status: 'failed',
                localPath,
                speedBytesPerSecond: 0,
                etaSeconds: null,
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

const cancelDownload = async (recordId) => {
    const control = activeDownloads.get(recordId);
    if (!control) {
        return false;
    }

    control.cancelRequested = true;

    if (control.request && !control.request.destroyed) {
        control.request.destroy(createDownloadError('Canceled by user'));
    }
    if (control.response && !control.response.destroyed) {
        control.response.destroy(createDownloadError('Canceled by user'));
    }
    if (control.fileStream && !control.fileStream.destroyed) {
        control.fileStream.destroy(createDownloadError('Canceled by user'));
    }

    try {
        await control.completionPromise;
    } catch {
        // The completion promise normalizes cancel state via onUpdate.
    }

    return true;
};

const isDownloadActive = (recordId) => activeDownloads.has(recordId);

module.exports = {
    startDownload,
    cancelDownload,
    isDownloadActive,
    isSupportedSourceUrl
};

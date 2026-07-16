/* eslint-disable no-console */

const express = require('express');
const cors = require('cors');
const { startDownload, cancelDownload, isDownloadActive, isSupportedSourceUrl } = require('./downloadManager');
const { isDownloadRetryable, prepareDownloadRetry } = require('./downloadRetry');
const { launchMediaFile } = require('./playerLauncher');
const { openDownloadLocation } = require('./fileExplorerLauncher');
const { DownloadRecordStore, recoverInterruptedDownloadRecords } = require('./downloadRecordStore');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 5577;
const SERVICE_NAME = 'custom-stremio-local-backend';
const SERVICE_VERSION = 'dev';
const ACTIVE_DUPLICATE_STATUSES = new Set(['queued', 'downloading', 'paused', 'completed']);

const app = express();
const downloads = new Map();
const recordStore = new DownloadRecordStore({
    onError: (error) => console.error('Could not persist download records:', error)
});
let downloadCounter = 0;
let httpServer = null;
let shuttingDown = false;

const getNowIso = () => new Date().toISOString();

const pickSourceUrl = (payload) => {
    return payload?.downloadUrl ||
        payload?.streamingUrl ||
        payload?.streamUrl ||
        payload?.externalUrl ||
        null;
};

const createDownloadId = () => {
    downloadCounter += 1;
    return `dl_${Date.now()}_${downloadCounter}`;
};

const createDownloadRecord = (payload) => {
    const now = getNowIso();
    const sourceUrl = pickSourceUrl(payload);

    return {
        metaId: payload?.metaId ?? null,
        type: payload?.type ?? null,
        parentTitle: payload?.parentTitle ?? payload?.videoTitle ?? null,
        poster: payload?.poster ?? null,
        background: payload?.background ?? null,
        logo: payload?.logo ?? null,
        description: payload?.description ?? null,
        runtime: payload?.runtime ?? null,
        releaseInfo: payload?.releaseInfo ?? null,
        titleReleased: payload?.titleReleased ?? null,
        metaLinks: Array.isArray(payload?.metaLinks) ? payload.metaLinks : [],
        videoId: payload?.videoId ?? null,
        videoTitle: payload?.videoTitle ?? null,
        videoThumbnail: payload?.videoThumbnail ?? null,
        season: typeof payload?.season === 'number' ? payload.season : null,
        episode: typeof payload?.episode === 'number' ? payload.episode : null,
        videoReleased: payload?.videoReleased ?? null,
        addonName: payload?.addonName ?? null,
        streamName: payload?.streamName ?? null,
        streamDescription: payload?.streamDescription ?? null,
        streamUrl: payload?.streamUrl ?? null,
        externalUrl: payload?.externalUrl ?? null,
        downloadUrl: payload?.downloadUrl ?? null,
        fileName: payload?.fileName ?? null,
        streamingUrl: payload?.streamingUrl ?? null,
        id: createDownloadId(),
        sourceUrl,
        status: 'queued',
        localPath: null,
        bytesDownloaded: 0,
        bytesTotal: null,
        progress: 0,
        speedBytesPerSecond: 0,
        etaSeconds: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        error: null,
        attemptCount: 1,
        lastAttemptAt: now
    };
};

const getPersistableDownloadRecords = () => Array.from(downloads.values()).filter((record) => record.status !== 'deleted');

const scheduleDownloadRecordsPersistence = () => {
    recordStore.schedule(getPersistableDownloadRecords());
};

const persistDownloadRecordsNow = () => recordStore.flush(getPersistableDownloadRecords());

const getPayloadVideoId = (payload) => {
    return typeof payload?.videoId === 'string' && payload.videoId.length > 0 ? payload.videoId : null;
};

const findActiveDuplicateDownload = (payload, sourceUrl) => {
    const payloadMetaId = payload?.metaId ?? null;
    const payloadType = payload?.type ?? null;
    const payloadVideoId = getPayloadVideoId(payload);

    return Array.from(downloads.values()).find((record) => {
        if (!ACTIVE_DUPLICATE_STATUSES.has(record.status)) {
            return false;
        }

        if (record.sourceUrl !== sourceUrl || record.metaId !== payloadMetaId) {
            return false;
        }

        if (payloadVideoId !== null) {
            return record.videoId === payloadVideoId;
        }

        return (record.videoId === null || record.videoId === undefined) && record.type === payloadType;
    }) || null;
};

const updateDownloadRecord = (record, updates) => {
    const nextRecord = {
        ...record,
        ...updates,
        updatedAt: getNowIso()
    };

    downloads.set(record.id, nextRecord);
    scheduleDownloadRecordsPersistence();
    return nextRecord;
};

const updateDownloadRecordById = (recordId, updates) => {
    const existingRecord = downloads.get(recordId);
    if (!existingRecord) {
        return null;
    }

    return updateDownloadRecord(existingRecord, updates);
};

const getDownloadRecordOrSend404 = (id, response) => {
    const record = downloads.get(id);
    if (!record) {
        response.status(404).json({
            ok: false,
            error: 'Download not found'
        });
        return null;
    }

    return record;
};

const startBackgroundDownload = (record) => {
    (async () => {
        try {
            await startDownload(record, updateDownloadRecordById);
        } catch (error) {
            const nextRecord = downloads.get(record.id);
            if (nextRecord && nextRecord.status !== 'failed' && nextRecord.status !== 'canceled') {
                updateDownloadRecord(nextRecord, {
                    status: 'failed',
                    error: error?.message || 'Download failed',
                    completedAt: null,
                    speedBytesPerSecond: 0,
                    etaSeconds: null
                });
            }
        } finally {
            await persistDownloadRecordsNow().catch((error) => {
                console.error('Could not persist final download state:', error);
            });
        }
    })();
};

app.use(cors());
app.use(express.json());

app.use((request, response, next) => {
    console.log(`${request.method} ${request.path}`);
    next();
});

app.get('/health', (request, response) => {
    response.json({
        ok: true,
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        time: getNowIso()
    });
});

app.post('/downloads', async (request, response) => {
    const payload = request.body;

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        response.status(400).json({
            ok: false,
            error: 'Request body must be a JSON object'
        });
        return;
    }

    const sourceUrl = pickSourceUrl(payload);
    if (!sourceUrl) {
        response.status(400).json({
            ok: false,
            error: 'No usable source URL found. Expected downloadUrl, streamingUrl, streamUrl, or externalUrl.'
        });
        return;
    }

    if (!isSupportedSourceUrl(sourceUrl)) {
        response.status(400).json({
            ok: false,
            error: 'Unsupported source URL protocol. Only http and https are supported.'
        });
        return;
    }

    const duplicateRecord = findActiveDuplicateDownload(payload, sourceUrl);
    if (duplicateRecord) {
        response.status(200).json({
            ...duplicateRecord,
            duplicate: true
        });
        return;
    }

    const record = createDownloadRecord(payload);
    downloads.set(record.id, record);
    try {
        await persistDownloadRecordsNow();
    } catch (error) {
        downloads.delete(record.id);
        console.error('Could not persist new download record:', error);
        response.status(500).json({
            ok: false,
            error: 'Could not save the new download record'
        });
        return;
    }

    startBackgroundDownload(record);
    response.status(201).json({
        ...record,
        duplicate: false
    });
});

app.get('/downloads', (request, response) => {
    const metaId = typeof request.query.metaId === 'string' ? request.query.metaId : null;
    const items = Array.from(downloads.values()).filter((record) => {
        if (record.status === 'deleted') {
            return false;
        }

        if (metaId !== null) {
            return record.metaId === metaId;
        }

        return true;
    });

    response.json({ items });
});

app.get('/downloads/:id', (request, response) => {
    const record = getDownloadRecordOrSend404(request.params.id, response);
    if (!record) {
        return;
    }

    response.json(record);
});

app.post('/downloads/:id/pause', (request, response) => {
    const record = getDownloadRecordOrSend404(request.params.id, response);
    if (!record) {
        return;
    }

    response.status(501).json({
        ok: false,
        error: 'Pause is not implemented yet'
    });
});

app.post('/downloads/:id/resume', (request, response) => {
    const record = getDownloadRecordOrSend404(request.params.id, response);
    if (!record) {
        return;
    }

    response.status(501).json({
        ok: false,
        error: 'Resume is not implemented yet'
    });
});

app.post('/downloads/:id/retry', async (request, response) => {
    const record = getDownloadRecordOrSend404(request.params.id, response);
    if (!record) {
        return;
    }

    if (!isDownloadRetryable(record) || isDownloadActive(record.id)) {
        response.status(409).json({
            ok: false,
            error: 'Only inactive failed or canceled downloads can be retried'
        });
        return;
    }

    if (!isSupportedSourceUrl(record.sourceUrl)) {
        response.status(409).json({
            ok: false,
            error: 'This download no longer has a usable HTTP or HTTPS source URL'
        });
        return;
    }

    let retriedRecord;
    try {
        retriedRecord = await prepareDownloadRetry(record, getNowIso());
    } catch (error) {
        console.error('Could not prepare download retry:', error);
        response.status(error?.code === 'DOWNLOAD_NOT_RETRYABLE' ? 409 : 500).json({
            ok: false,
            errorCode: error?.code || 'DOWNLOAD_RETRY_PREPARATION_FAILED',
            error: error?.message || 'Could not prepare the download for retry'
        });
        return;
    }

    downloads.set(record.id, retriedRecord);
    try {
        await persistDownloadRecordsNow();
    } catch (error) {
        downloads.set(record.id, record);
        scheduleDownloadRecordsPersistence();
        console.error('Could not persist retried download record:', error);
        response.status(500).json({
            ok: false,
            error: 'Could not save the retried download record'
        });
        return;
    }

    startBackgroundDownload(retriedRecord);
    response.status(202).json(retriedRecord);
});

app.post('/downloads/:id/cancel', async (request, response) => {
    const record = getDownloadRecordOrSend404(request.params.id, response);
    if (!record) {
        return;
    }

    if (isDownloadActive(record.id)) {
        await cancelDownload(record.id);
        try {
            await persistDownloadRecordsNow();
        } catch (error) {
            console.error('Could not persist canceled download record:', error);
            response.status(500).json({
                ok: false,
                error: 'Download was canceled but its saved record could not be updated'
            });
            return;
        }
        response.json(downloads.get(record.id) || record);
        return;
    }

    if (record.status === 'queued') {
        const canceledRecord = updateDownloadRecord(record, {
            status: 'canceled',
            speedBytesPerSecond: 0,
            etaSeconds: null,
            error: null
        });
        try {
            await persistDownloadRecordsNow();
        } catch (error) {
            console.error('Could not persist canceled download record:', error);
            response.status(500).json({
                ok: false,
                error: 'Download was canceled but its saved record could not be updated'
            });
            return;
        }
        response.json(canceledRecord);
        return;
    }

    response.json(record);
});

app.delete('/downloads/:id', async (request, response) => {
    const record = getDownloadRecordOrSend404(request.params.id, response);
    if (!record) {
        return;
    }

    if (isDownloadActive(record.id)) {
        await cancelDownload(record.id);
    }

    const latestRecord = downloads.get(record.id) || record;
    downloads.delete(record.id);

    try {
        await persistDownloadRecordsNow();
    } catch (error) {
        downloads.set(latestRecord.id, latestRecord);
        console.error('Could not persist removed download record:', error);
        response.status(500).json({
            ok: false,
            error: 'Could not remove the saved download record'
        });
        return;
    }

    response.json({
        ok: true,
        id: latestRecord.id,
        status: 'deleted'
    });
});

app.post('/downloads/:id/open-location', async (request, response) => {
    const record = getDownloadRecordOrSend404(request.params.id, response);
    if (!record) {
        return;
    }

    if (!record.localPath) {
        response.status(409).json({
            ok: false,
            error: 'This download does not have a local path yet'
        });
        return;
    }

    try {
        const result = await openDownloadLocation(record.localPath);
        response.json({
            ok: true,
            downloadId: record.id,
            directoryPath: result.directoryPath,
            opened: true
        });
    } catch (error) {
        const status = ['DOWNLOAD_PATH_INVALID', 'DOWNLOAD_DIRECTORY_NOT_FOUND'].includes(error?.code) ? 410 : 500;
        response.status(status).json({
            ok: false,
            errorCode: error?.code || 'FILE_EXPLORER_LAUNCH_FAILED',
            error: error?.message || 'Could not open the download location'
        });
    }
});

app.post('/play', async (request, response) => {
    const downloadId = typeof request.body?.downloadId === 'string' ? request.body.downloadId.trim() : '';
    if (!downloadId) {
        response.status(400).json({
            ok: false,
            error: 'downloadId is required'
        });
        return;
    }

    const record = getDownloadRecordOrSend404(downloadId, response);
    if (!record) {
        return;
    }

    if (record.status !== 'completed') {
        response.status(409).json({
            ok: false,
            error: 'Only completed downloads can be played'
        });
        return;
    }

    try {
        const launchResult = await launchMediaFile(record.localPath);
        response.json({
            ok: true,
            downloadId: record.id,
            localPath: launchResult.localPath,
            launched: true
        });
    } catch (error) {
        const status = error?.code === 'MEDIA_FILE_NOT_FOUND' ?
            410
            :
            ['PLAYER_NOT_CONFIGURED', 'PLAYER_PATH_INVALID', 'PLAYER_NOT_FOUND'].includes(error?.code) ? 503 : 500;
        response.status(status).json({
            ok: false,
            errorCode: error?.code || 'PLAYER_LAUNCH_FAILED',
            error: error?.message || 'Could not launch the configured media player'
        });
    }
});

const shutdown = async (signal) => {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;
    console.log(`${signal} received; saving download records before shutdown.`);

    if (httpServer !== null) {
        await new Promise((resolve) => httpServer.close(resolve));
    }

    try {
        await persistDownloadRecordsNow();
        process.exit(0);
    } catch (error) {
        console.error('Could not persist download records during shutdown:', error);
        process.exit(1);
    }
};

const startServer = async () => {
    const storedRecords = await recordStore.load();
    const recovery = recoverInterruptedDownloadRecords(storedRecords);
    recovery.records.forEach((record) => downloads.set(record.id, record));

    if (recovery.recoveredCount > 0) {
        await persistDownloadRecordsNow();
        console.log(`Recovered ${recovery.recoveredCount} interrupted download record(s) as failed.`);
    }

    httpServer = app.listen(PORT, HOST, () => {
        console.log(`${SERVICE_NAME} listening on http://${HOST}:${PORT}`);
        console.log(`Download records: ${recordStore.filePath}`);
    });

    process.once('SIGINT', () => {
        shutdown('SIGINT');
    });
    process.once('SIGTERM', () => {
        shutdown('SIGTERM');
    });
};

startServer().catch((error) => {
    console.error('Could not start the local backend:', error);
    process.exitCode = 1;
});

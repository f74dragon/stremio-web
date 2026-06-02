const express = require('express');
const cors = require('cors');
const { startDownload, cancelDownload, isDownloadActive, isSupportedSourceUrl } = require('./downloadManager');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 5577;
const SERVICE_NAME = 'custom-stremio-local-backend';
const SERVICE_VERSION = 'dev';
const ACTIVE_DUPLICATE_STATUSES = new Set(['queued', 'downloading', 'paused', 'completed']);

const app = express();
const downloads = new Map();
let downloadCounter = 0;

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
        videoId: payload?.videoId ?? null,
        videoTitle: payload?.videoTitle ?? null,
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
        error: null
    };
};

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
    startDownload(record, updateDownloadRecordById).catch((error) => {
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
    });
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

app.post('/downloads', (request, response) => {
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

app.post('/downloads/:id/cancel', async (request, response) => {
    const record = getDownloadRecordOrSend404(request.params.id, response);
    if (!record) {
        return;
    }

    if (isDownloadActive(record.id)) {
        await cancelDownload(record.id);
        response.json(downloads.get(record.id) || record);
        return;
    }

    if (record.status === 'queued') {
        response.json(updateDownloadRecord(record, {
            status: 'canceled',
            speedBytesPerSecond: 0,
            etaSeconds: null,
            error: null
        }));
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
    const deletedRecord = updateDownloadRecord(latestRecord, {
        status: 'deleted',
        speedBytesPerSecond: 0,
        etaSeconds: null
    });
    response.json({
        ok: true,
        id: deletedRecord.id,
        status: deletedRecord.status
    });
});

app.listen(PORT, HOST, () => {
    console.log(`${SERVICE_NAME} listening on http://${HOST}:${PORT}`);
});

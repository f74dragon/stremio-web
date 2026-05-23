const express = require('express');
const cors = require('cors');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 5577;
const SERVICE_NAME = 'custom-stremio-local-backend';
const SERVICE_VERSION = 'dev';

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

const updateDownloadRecord = (record, updates) => {
    const nextRecord = {
        ...record,
        ...updates,
        updatedAt: getNowIso()
    };

    downloads.set(record.id, nextRecord);
    return nextRecord;
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

app.use(cors());
app.use(express.json());

app.use((request, response, next) => {
    console.log(`${request.method} ${request.route?.path || request.path.split('/')[1] || '/'}`);
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

    const record = createDownloadRecord(payload);
    downloads.set(record.id, record);
    response.status(201).json(record);
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

    if (record.status === 'queued' || record.status === 'downloading') {
        response.json(updateDownloadRecord(record, { status: 'paused' }));
        return;
    }

    response.json(record);
});

app.post('/downloads/:id/resume', (request, response) => {
    const record = getDownloadRecordOrSend404(request.params.id, response);
    if (!record) {
        return;
    }

    if (record.status === 'paused') {
        response.json(updateDownloadRecord(record, { status: 'queued' }));
        return;
    }

    response.json(record);
});

app.post('/downloads/:id/cancel', (request, response) => {
    const record = getDownloadRecordOrSend404(request.params.id, response);
    if (!record) {
        return;
    }

    if (record.status === 'queued' || record.status === 'downloading' || record.status === 'paused') {
        response.json(updateDownloadRecord(record, { status: 'canceled' }));
        return;
    }

    response.json(record);
});

app.delete('/downloads/:id', (request, response) => {
    const record = getDownloadRecordOrSend404(request.params.id, response);
    if (!record) {
        return;
    }

    const deletedRecord = updateDownloadRecord(record, { status: 'deleted' });
    response.json({
        ok: true,
        id: deletedRecord.id,
        status: deletedRecord.status
    });
});

app.listen(PORT, HOST, () => {
    console.log(`${SERVICE_NAME} listening on http://${HOST}:${PORT}`);
});

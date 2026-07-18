/* eslint-disable no-console */

const express = require('express');
const cors = require('cors');
const {
    startDownload,
    pauseDownload,
    cancelDownload,
    isDownloadActive,
    isSupportedSourceUrl,
    isKnownNotReadySourceUrl
} = require('./downloadManager');
const { isDownloadRetryable, prepareDownloadRetry } = require('./downloadRetry');
const { isDownloadResumable, prepareDownloadResume } = require('./downloadResume');
const {
    DownloadScheduler,
    UNLIMITED_CONCURRENT_DOWNLOADS,
    isValidMaxConcurrentDownloads,
    getConfiguredMaxConcurrentDownloads,
    sortQueuedDownloadRecords
} = require('./downloadScheduler');
const { createBackendSettings, BackendSettingsStore } = require('./backendSettingsStore');
const { AllDebridClient } = require('./allDebridClient');
const { AllDebridCleanupStore } = require('./allDebridCleanupStore');
const { AllDebridAvailabilityStore } = require('./allDebridAvailabilityStore');
const { AllDebridAvailabilityService } = require('./allDebridAvailability');
const {
    getConfiguredPlayerPath,
    validatePlayerExecutable,
    launchMediaFile
} = require('./playerLauncher');
const { selectPlayerExecutable } = require('./playerExecutableSelector');
const { openDownloadLocation } = require('./fileExplorerLauncher');
const { DownloadRecordStore, recoverInterruptedDownloadRecords } = require('./downloadRecordStore');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 5577;
const SERVICE_NAME = 'custom-stremio-local-backend';
const SERVICE_VERSION = 'dev';
const ACTIVE_DUPLICATE_STATUSES = new Set(['queued', 'downloading', 'paused', 'completed']);
const DEFAULT_TRUSTED_DEBRID_ORIGINS = new Set([
    'http://localhost:8080',
    'https://localhost:8080',
    'http://127.0.0.1:8080',
    'https://127.0.0.1:8080'
]);
const TRUSTED_DEBRID_ORIGINS = new Set([
    ...DEFAULT_TRUSTED_DEBRID_ORIGINS,
    ...String(process.env.CUSTOM_STREMIO_ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean)
]);
const ALLDEBRID_STREAM_MARKER = /(?:^|[^a-z0-9])ad\s*(?:\+|download)(?:$|[^a-z0-9])/i;

const app = express();
const downloads = new Map();
const recordStore = new DownloadRecordStore({
    onError: (error) => console.error('Could not persist download records:', error)
});
const downloadScheduler = new DownloadScheduler({
    maxConcurrentDownloads: getConfiguredMaxConcurrentDownloads(),
    onTaskError: (error, recordId) => console.error(`Scheduled download ${recordId} failed unexpectedly:`, error)
});
const settingsStore = new BackendSettingsStore();
const allDebridClient = new AllDebridClient();
const allDebridCleanupStore = new AllDebridCleanupStore();
const allDebridAvailabilityStore = new AllDebridAvailabilityStore();
const allDebridAvailability = new AllDebridAvailabilityService({
    client: allDebridClient,
    cleanupStore: allDebridCleanupStore,
    historyStore: allDebridAvailabilityStore,
    onWarning: (message) => console.warn(message)
});
let backendSettings = createBackendSettings(downloadScheduler.maxConcurrentDownloads);
let allDebridPinSession = null;
let allDebridPendingCleanupCount = 0;
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

const isAllDebridResolverRecord = (record) => {
    const searchableText = [record?.streamName, record?.streamDescription]
        .filter((value) => typeof value === 'string')
        .join('\n');
    return Boolean(record?.infoHash) && ALLDEBRID_STREAM_MARKER.test(searchableText);
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
        sourceReadiness: payload?.sourceReadiness ?? 'unknown',
        infoHash: payload?.infoHash ?? null,
        fileIdx: Number.isSafeInteger(payload?.fileIdx) ? payload.fileIdx : null,
        behaviorHints: {
            filename: payload?.behaviorHints?.filename ?? null,
            videoSize: Number.isFinite(payload?.behaviorHints?.videoSize) ? payload.behaviorHints.videoSize : null
        },
        streamUrl: payload?.streamUrl ?? null,
        externalUrl: payload?.externalUrl ?? null,
        downloadUrl: payload?.downloadUrl ?? null,
        fileName: payload?.fileName ?? null,
        streamingUrl: payload?.streamingUrl ?? null,
        id: createDownloadId(),
        sourceUrl,
        status: 'queued',
        localPath: null,
        partialPath: null,
        bytesDownloaded: 0,
        bytesTotal: null,
        progress: 0,
        speedBytesPerSecond: 0,
        etaSeconds: null,
        queuedAt: now,
        queueOrder: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        error: null,
        errorCode: null,
        resumeSupported: null,
        sourceEtag: null,
        sourceLastModified: null,
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

const runScheduledDownload = async (recordId, options) => {
    let record = downloads.get(recordId);
    if (!record || record.status !== 'queued') {
        return;
    }

    if (record.queueOrder !== null && record.queueOrder !== undefined) {
        record = { ...record, queueOrder: null };
        downloads.set(record.id, record);
    }

    const apiKey = backendSettings.debrid.allDebrid?.apiKey;
    let preexistingMagnetIds = null;
    const isAllDebridResolver = apiKey && isAllDebridResolverRecord(record);
    if (isAllDebridResolver) {
        try {
            preexistingMagnetIds = await allDebridAvailability.snapshotMatchingMagnetIds(apiKey, record.infoHash);
        } catch (error) {
            console.warn(`Could not snapshot AllDebrid magnets before download ${record.id}: ${error.message || 'unknown error'}`);
        }
    }

    try {
        await startDownload(record, updateDownloadRecordById, options);
        const completedRecord = downloads.get(record.id);
        if (isAllDebridResolver && completedRecord?.status === 'completed') {
            await allDebridAvailability.recordObservation(record.infoHash, 'cached', 'completed_download').catch((error) => {
                console.warn(`Could not save cached AllDebrid history for download ${record.id}: ${error.message || 'unknown error'}`);
            });
        } else if (isAllDebridResolver && completedRecord?.status === 'failed' && completedRecord.errorCode === 'SOURCE_NOT_READY') {
            if (preexistingMagnetIds !== null) {
                await allDebridAvailability.cleanupNewMagnetsForHash(apiKey, record.infoHash, preexistingMagnetIds)
                    .then((cleanup) => {
                        allDebridPendingCleanupCount = cleanup.pending;
                    })
                    .catch((error) => {
                        console.warn(`Could not identify or clean up AllDebrid magnets for download ${record.id}: ${error.message || 'unknown error'}`);
                    });
            }
            await allDebridAvailability.recordObservation(record.infoHash, 'uncached', 'placeholder_response').catch((error) => {
                console.warn(`Could not save not-cached AllDebrid history for download ${record.id}: ${error.message || 'unknown error'}`);
            });
        }
    } catch (error) {
        const nextRecord = downloads.get(record.id);
        if (nextRecord && !['failed', 'canceled', 'paused'].includes(nextRecord.status)) {
            updateDownloadRecord(nextRecord, {
                status: 'failed',
                error: error?.message || 'Download failed',
                errorCode: error?.code || null,
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
};

const enqueueDownload = (record, options) => {
    const savedBytes = Number(record?.bytesDownloaded);
    const scheduledOptions = options || (Number.isSafeInteger(savedBytes) && savedBytes > 0 ? { resumeOffset: savedBytes } : undefined);
    return downloadScheduler.enqueue(record.id, () => runScheduledDownload(record.id, scheduledOptions));
};

const createQueueMetadata = () => {
    const queuedIds = downloadScheduler.getSnapshot().queuedIds;
    return {
        queueLength: queuedIds.length,
        positions: new Map(queuedIds.map((id, index) => [id, index + 1]))
    };
};

const getDownloadRecordResponse = (record, queueMetadata = createQueueMetadata()) => {
    if (!record || record.status !== 'queued') {
        return record;
    }

    const queuePosition = queueMetadata.positions.get(record.id);
    return {
        ...record,
        queuePosition: Number.isSafeInteger(queuePosition) ? queuePosition : null,
        queueLength: queueMetadata.queueLength
    };
};

const getDownloadRecordsResponse = (records) => {
    const queueMetadata = createQueueMetadata();
    return records.map((record) => getDownloadRecordResponse(record, queueMetadata));
};

const applyPersistedQueueOrder = (queuedIds) => {
    const previousRecords = new Map();
    queuedIds.forEach((id, index) => {
        const record = downloads.get(id);
        if (record?.status === 'queued') {
            previousRecords.set(id, record);
            downloads.set(id, { ...record, queueOrder: index + 1 });
        }
    });
    return previousRecords;
};

const restoreDownloadRecords = (recordsById) => {
    recordsById.forEach((record, id) => {
        if (downloads.has(id)) {
            downloads.set(id, record);
        }
    });
};

const getAllDebridConnectionResponse = () => {
    const settings = backendSettings.debrid.allDebrid;
    return {
        connected: Boolean(settings?.apiKey),
        username: settings?.username ?? null,
        isPremium: settings?.isPremium === true,
        premiumUntil: settings?.premiumUntil ?? null,
        pendingCleanup: allDebridPendingCleanupCount
    };
};

const getBackendSettingsResponse = () => ({
    downloads: {
        maxConcurrentDownloads: backendSettings.downloads.maxConcurrentDownloads,
        minAllowedConcurrentDownloads: 1,
        maxAllowedConcurrentDownloads: null,
        unlimitedValue: UNLIMITED_CONCURRENT_DOWNLOADS
    },
    player: {
        configured: Boolean(backendSettings.player.executablePath),
        executablePath: backendSettings.player.executablePath
    },
    debrid: {
        allDebrid: getAllDebridConnectionResponse()
    }
});

const saveAllDebridConnection = async (allDebrid) => {
    backendSettings = await settingsStore.save(createBackendSettings(
        backendSettings.downloads.maxConcurrentDownloads,
        allDebrid,
        backendSettings.player.executablePath
    ));
    return getAllDebridConnectionResponse();
};

const sendAllDebridError = (response, error, fallbackMessage) => {
    const authenticationError = ['AUTH_MISSING_APIKEY', 'AUTH_BAD_APIKEY', 'AUTH_BLOCKED', 'AUTH_USER_BANNED'].includes(error?.code);
    const invalidRequest = ['ALLDEBRID_TOO_MANY_HASHES', 'ALLDEBRID_INVALID_HASHES'].includes(error?.code);
    const status = authenticationError ? 401 : invalidRequest ? 400 : 502;
    response.status(status).json({
        ok: false,
        errorCode: error?.code || 'ALLDEBRID_REQUEST_FAILED',
        error: error?.message || fallbackMessage
    });
};

const requireTrustedLocalOrigin = (request, response, next) => {
    const origin = request.get('Origin');
    if (origin && !TRUSTED_DEBRID_ORIGINS.has(origin)) {
        response.status(403).json({
            ok: false,
            error: 'This origin is not allowed to use privileged local backend actions'
        });
        return;
    }
    next();
};

app.use(cors());
app.use(express.json());

app.use((request, response, next) => {
    console.log(`${request.method} ${request.path}`);
    next();
});

app.use('/debrid', requireTrustedLocalOrigin);

app.get('/health', (request, response) => {
    const scheduler = downloadScheduler.getSnapshot();
    response.json({
        ok: true,
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        time: getNowIso(),
        downloads: {
            maxConcurrent: scheduler.maxConcurrentDownloads,
            active: scheduler.activeCount,
            queued: scheduler.queuedCount
        }
    });
});

app.get('/settings', requireTrustedLocalOrigin, (request, response) => {
    response.json(getBackendSettingsResponse());
});

app.patch('/settings', requireTrustedLocalOrigin, async (request, response) => {
    const maxConcurrentDownloads = request.body?.downloads?.maxConcurrentDownloads;
    if (!isValidMaxConcurrentDownloads(maxConcurrentDownloads)) {
        response.status(400).json({
            ok: false,
            error: `downloads.maxConcurrentDownloads must be a positive safe integer or "${UNLIMITED_CONCURRENT_DOWNLOADS}"`
        });
        return;
    }

    const nextSettings = createBackendSettings(
        maxConcurrentDownloads,
        backendSettings.debrid.allDebrid,
        backendSettings.player.executablePath
    );
    try {
        backendSettings = await settingsStore.save(nextSettings);
    } catch (error) {
        console.error('Could not persist backend settings:', error);
        response.status(500).json({
            ok: false,
            error: 'Could not save local download settings'
        });
        return;
    }

    downloadScheduler.setMaxConcurrentDownloads(maxConcurrentDownloads);
    response.json(getBackendSettingsResponse());
});

app.post('/settings/player/select', requireTrustedLocalOrigin, async (request, response) => {
    try {
        const executablePath = await selectPlayerExecutable({
            currentExecutablePath: backendSettings.player.executablePath
        });
        if (!executablePath) {
            response.json({ ...getBackendSettingsResponse(), selectionCanceled: true });
            return;
        }

        await validatePlayerExecutable(executablePath);
        backendSettings = await settingsStore.save(createBackendSettings(
            backendSettings.downloads.maxConcurrentDownloads,
            backendSettings.debrid.allDebrid,
            executablePath
        ));
        response.json({ ...getBackendSettingsResponse(), selectionCanceled: false });
    } catch (error) {
        const status = error?.code === 'PLAYER_SELECTOR_UNSUPPORTED' ?
            501
            :
            ['PLAYER_PATH_INVALID', 'PLAYER_NOT_FOUND'].includes(error?.code) ? 400 : 500;
        response.status(status).json({
            ok: false,
            errorCode: error?.code || 'PLAYER_SELECTION_FAILED',
            error: error?.message || 'Could not choose the video player executable'
        });
    }
});

app.post('/debrid/alldebrid/auth/pin', async (request, response) => {
    try {
        const pin = await allDebridClient.getPin();
        const expiresIn = Number(pin?.expires_in);
        const expiresAt = new Date(Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 600) * 1000).toISOString();
        allDebridPinSession = {
            pin: pin.pin,
            check: pin.check,
            userUrl: pin.user_url,
            expiresAt
        };
        response.status(201).json({
            pin: pin.pin,
            userUrl: pin.user_url,
            expiresAt
        });
    } catch (error) {
        sendAllDebridError(response, error, 'Could not start AllDebrid authentication');
    }
});

app.post('/debrid/alldebrid/auth/pin/check', async (request, response) => {
    if (!allDebridPinSession) {
        response.status(409).json({ ok: false, error: 'No AllDebrid PIN connection is in progress' });
        return;
    }
    if (Date.parse(allDebridPinSession.expiresAt) <= Date.now()) {
        allDebridPinSession = null;
        response.status(410).json({ ok: false, error: 'The AllDebrid PIN expired. Start a new connection.' });
        return;
    }

    try {
        const pinResult = await allDebridClient.checkPin(allDebridPinSession.pin, allDebridPinSession.check);
        if (pinResult?.activated !== true || typeof pinResult.apikey !== 'string' || !pinResult.apikey) {
            response.json({
                activated: false,
                expiresAt: allDebridPinSession.expiresAt
            });
            return;
        }

        const userData = await allDebridClient.getUser(pinResult.apikey);
        const user = userData?.user || {};
        const connection = await saveAllDebridConnection({
            apiKey: pinResult.apikey,
            username: user.username,
            isPremium: user.isPremium,
            premiumUntil: user.premiumUntil
        });
        allDebridPinSession = null;
        response.json({ activated: true, connection });
    } catch (error) {
        if (['PIN_EXPIRED', 'PIN_INVALID'].includes(error?.code)) {
            allDebridPinSession = null;
        }
        sendAllDebridError(response, error, 'Could not complete AllDebrid authentication');
    }
});

app.delete('/debrid/alldebrid/auth', async (request, response) => {
    const apiKey = backendSettings.debrid.allDebrid?.apiKey;
    try {
        if (apiKey) {
            const cleanup = await allDebridAvailability.retryPendingCleanup(apiKey);
            allDebridPendingCleanupCount = cleanup.pending;
        } else {
            allDebridPendingCleanupCount = await allDebridAvailability.getPendingCleanupCount();
        }
        if (allDebridPendingCleanupCount > 0) {
            response.status(409).json({
                ok: false,
                error: 'Temporary AllDebrid magnets still need cleanup. Keep the connection and try again.'
            });
            return;
        }

        await saveAllDebridConnection(null);
        allDebridPinSession = null;
        allDebridAvailability.clearCache();
        response.json({ ok: true, connection: getAllDebridConnectionResponse() });
    } catch (error) {
        sendAllDebridError(response, error, 'Could not disconnect AllDebrid');
    }
});

app.post('/debrid/alldebrid/availability', async (request, response) => {
    const apiKey = backendSettings.debrid.allDebrid?.apiKey;
    if (!apiKey) {
        response.json({
            provider: 'alldebrid',
            connected: false,
            items: [],
            pendingCleanup: allDebridPendingCleanupCount,
            cleanupWarning: null
        });
        return;
    }

    try {
        const result = await allDebridAvailability.check(apiKey, request.body?.hashes);
        allDebridPendingCleanupCount = result.pendingCleanup;
        response.json({
            provider: 'alldebrid',
            connected: true,
            ...result
        });
    } catch (error) {
        allDebridPendingCleanupCount = await allDebridAvailability.getPendingCleanupCount().catch(() => allDebridPendingCleanupCount);
        sendAllDebridError(response, error, 'Could not check AllDebrid availability');
    }
});

app.post('/debrid/alldebrid/availability/history', async (request, response) => {
    try {
        const result = await allDebridAvailability.getHistory(request.body?.hashes);
        response.json({
            provider: 'alldebrid',
            connected: Boolean(backendSettings.debrid.allDebrid?.apiKey),
            ...result
        });
    } catch (error) {
        sendAllDebridError(response, error, 'Could not read AllDebrid availability history');
    }
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

    if (payload.sourceReadiness === 'requires_caching' || isKnownNotReadySourceUrl(sourceUrl)) {
        response.status(409).json({
            ok: false,
            errorCode: 'SOURCE_NOT_READY',
            error: 'This source is not cached yet. Choose a cached source or try again later.'
        });
        return;
    }

    const duplicateRecord = findActiveDuplicateDownload(payload, sourceUrl);
    if (duplicateRecord) {
        response.status(200).json({
            ...getDownloadRecordResponse(duplicateRecord),
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

    enqueueDownload(record);
    response.status(201).json({
        ...getDownloadRecordResponse(downloads.get(record.id) || record),
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

    response.json({ items: getDownloadRecordsResponse(items) });
});

app.get('/downloads/:id', (request, response) => {
    const record = getDownloadRecordOrSend404(request.params.id, response);
    if (!record) {
        return;
    }

    response.json(getDownloadRecordResponse(record));
});

app.patch('/downloads/:id/queue', async (request, response) => {
    const record = getDownloadRecordOrSend404(request.params.id, response);
    if (!record) {
        return;
    }

    const position = request.body?.position;
    if (!Number.isSafeInteger(position) || position < 1) {
        response.status(400).json({
            ok: false,
            error: 'position must be a positive integer'
        });
        return;
    }

    const previousSnapshot = downloadScheduler.getSnapshot();
    if (record.status !== 'queued' || !previousSnapshot.queuedIds.includes(record.id)) {
        response.status(409).json({
            ok: false,
            error: 'Only waiting queued downloads can be reordered'
        });
        return;
    }
    if (position > previousSnapshot.queuedCount) {
        response.status(400).json({
            ok: false,
            error: `position must be between 1 and ${previousSnapshot.queuedCount}`
        });
        return;
    }

    const currentPosition = previousSnapshot.queuedIds.indexOf(record.id) + 1;
    if (position === currentPosition) {
        response.json(getDownloadRecordResponse(record));
        return;
    }

    const nextSnapshot = downloadScheduler.move(record.id, position);
    const previousRecords = applyPersistedQueueOrder(nextSnapshot.queuedIds);
    try {
        await persistDownloadRecordsNow();
    } catch (error) {
        restoreDownloadRecords(previousRecords);
        try {
            downloadScheduler.setQueueOrder(previousSnapshot.queuedIds);
        } catch {
            // A slot changed while persistence was in progress; preserve the live scheduler state.
        }
        scheduleDownloadRecordsPersistence();
        console.error('Could not persist reordered download queue:', error);
        response.status(500).json({
            ok: false,
            error: 'Could not save the new download queue order'
        });
        return;
    }

    response.json(getDownloadRecordResponse(downloads.get(record.id) || record));
});

app.post('/downloads/:id/pause', async (request, response) => {
    const record = getDownloadRecordOrSend404(request.params.id, response);
    if (!record) {
        return;
    }

    if (record.status === 'paused') {
        response.json(record);
        return;
    }

    if (downloadScheduler.isQueued(record.id)) {
        downloadScheduler.remove(record.id);
        updateDownloadRecord(record, {
            status: 'paused',
            speedBytesPerSecond: 0,
            etaSeconds: null,
            completedAt: null,
            error: null
        });
    } else if (isDownloadActive(record.id)) {
        await pauseDownload(record.id);
    } else if (record.status === 'queued' || record.status === 'downloading') {
        updateDownloadRecord(record, {
            status: 'paused',
            speedBytesPerSecond: 0,
            etaSeconds: null,
            completedAt: null,
            error: null
        });
    } else {
        response.status(409).json({
            ok: false,
            error: 'Only queued or downloading records can be paused'
        });
        return;
    }

    try {
        await persistDownloadRecordsNow();
    } catch (error) {
        console.error('Could not persist paused download record:', error);
        response.status(500).json({
            ok: false,
            error: 'Download was paused but its saved record could not be updated'
        });
        return;
    }

    response.json(downloads.get(record.id) || record);
});

app.post('/downloads/:id/resume', async (request, response) => {
    const record = getDownloadRecordOrSend404(request.params.id, response);
    if (!record) {
        return;
    }

    if (!isDownloadResumable(record) || isDownloadActive(record.id)) {
        response.status(409).json({
            ok: false,
            error: 'Only inactive paused downloads can be resumed'
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

    let resumePreparation;
    try {
        resumePreparation = await prepareDownloadResume(record, getNowIso());
    } catch (error) {
        const conflictCodes = new Set([
            'DOWNLOAD_NOT_RESUMABLE',
            'DOWNLOAD_PARTIAL_FILE_MISSING',
            'DOWNLOAD_PARTIAL_FILE_INVALID',
            'DOWNLOAD_PARTIAL_FILE_TOO_LARGE'
        ]);
        response.status(conflictCodes.has(error?.code) ? 409 : 500).json({
            ok: false,
            errorCode: error?.code || 'DOWNLOAD_RESUME_PREPARATION_FAILED',
            error: error?.message || 'Could not prepare the download to resume'
        });
        return;
    }

    downloads.set(record.id, resumePreparation.record);
    try {
        await persistDownloadRecordsNow();
    } catch (error) {
        downloads.set(record.id, record);
        scheduleDownloadRecordsPersistence();
        console.error('Could not persist resumed download record:', error);
        response.status(500).json({
            ok: false,
            error: 'Could not save the resumed download record'
        });
        return;
    }

    enqueueDownload(resumePreparation.record, { resumeOffset: resumePreparation.resumeOffset });
    response.status(202).json(getDownloadRecordResponse(downloads.get(record.id) || resumePreparation.record));
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

    enqueueDownload(retriedRecord);
    response.status(202).json(getDownloadRecordResponse(downloads.get(record.id) || retriedRecord));
});

app.post('/downloads/:id/cancel', async (request, response) => {
    const record = getDownloadRecordOrSend404(request.params.id, response);
    if (!record) {
        return;
    }

    if (downloadScheduler.isQueued(record.id)) {
        downloadScheduler.remove(record.id);
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

    if (record.status === 'queued' || record.status === 'paused') {
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

    const wasQueued = downloadScheduler.isQueued(record.id);
    if (wasQueued) {
        downloadScheduler.remove(record.id);
    } else if (isDownloadActive(record.id)) {
        await cancelDownload(record.id);
    }

    const latestRecord = downloads.get(record.id) || record;
    downloads.delete(record.id);

    try {
        await persistDownloadRecordsNow();
    } catch (error) {
        downloads.set(latestRecord.id, latestRecord);
        if (wasQueued) {
            enqueueDownload(latestRecord);
        }
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
        const launchResult = await launchMediaFile(record.localPath, backendSettings.player.executablePath);
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
    downloadScheduler.stop();
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
    backendSettings = await settingsStore.load(createBackendSettings(
        getConfiguredMaxConcurrentDownloads(),
        null,
        getConfiguredPlayerPath()
    ));
    downloadScheduler.setMaxConcurrentDownloads(backendSettings.downloads.maxConcurrentDownloads);

    const allDebridApiKey = backendSettings.debrid.allDebrid?.apiKey;
    if (allDebridApiKey) {
        try {
            const cleanup = await allDebridAvailability.retryPendingCleanup(allDebridApiKey);
            allDebridPendingCleanupCount = cleanup.pending;
            if (cleanup.cleaned > 0) {
                console.log(`Cleaned up ${cleanup.cleaned} temporary AllDebrid magnet(s) left by an interrupted check.`);
            }
        } catch (error) {
            allDebridPendingCleanupCount = await allDebridAvailability.getPendingCleanupCount().catch(() => 0);
            console.warn(`Could not retry pending AllDebrid cleanup during startup: ${error.message || 'unknown error'}`);
        }
    } else {
        allDebridPendingCleanupCount = await allDebridAvailability.getPendingCleanupCount();
    }

    const storedRecords = await recordStore.load();
    const recovery = recoverInterruptedDownloadRecords(storedRecords);
    recovery.records.forEach((record) => downloads.set(record.id, record));

    const queuedRecords = sortQueuedDownloadRecords(recovery.records.filter((record) => record.status === 'queued'));
    let restoredQueuedCount = 0;
    for (const queuedRecord of queuedRecords) {
        let recordToQueue = queuedRecord;
        let options;
        if (Number(queuedRecord.bytesDownloaded) > 0) {
            try {
                const preparation = await prepareDownloadResume({ ...queuedRecord, status: 'paused' }, getNowIso());
                recordToQueue = {
                    ...preparation.record,
                    queuedAt: queuedRecord.queuedAt || queuedRecord.createdAt || getNowIso(),
                    queueOrder: queuedRecord.queueOrder ?? null
                };
                downloads.set(recordToQueue.id, recordToQueue);
                options = { resumeOffset: preparation.resumeOffset };
            } catch (error) {
                downloads.set(queuedRecord.id, {
                    ...queuedRecord,
                    status: 'paused',
                    speedBytesPerSecond: 0,
                    etaSeconds: null,
                    updatedAt: getNowIso(),
                    error: `Queued download could not be restored: ${error?.message || 'partial file validation failed'}`
                });
                continue;
            }
        }

        enqueueDownload(recordToQueue, options);
        restoredQueuedCount += 1;
    }

    if (recovery.recoveredCount > 0 || queuedRecords.length > 0) {
        await persistDownloadRecordsNow();
    }
    if (recovery.recoveredCount > 0) {
        console.log(`Recovered ${recovery.recoveredCount} interrupted active download record(s) as paused.`);
    }
    if (restoredQueuedCount > 0) {
        console.log(`Restored ${restoredQueuedCount} queued download record(s).`);
    }

    httpServer = app.listen(PORT, HOST, () => {
        console.log(`${SERVICE_NAME} listening on http://${HOST}:${PORT}`);
        console.log(`Download records: ${recordStore.filePath}`);
        console.log(`Backend settings: ${settingsStore.filePath}`);
        console.log(`Maximum concurrent downloads: ${downloadScheduler.maxConcurrentDownloads}`);
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

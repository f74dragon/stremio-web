/* eslint-disable no-console */

const express = require('express');
const cors = require('cors');
const path = require('path');
const {
    startDownload,
    pauseDownload,
    cancelDownload,
    isDownloadActive,
    isSupportedSourceUrl,
    classifyKnownPlaceholderSourceUrl
} = require('./downloadManager');
const { isDownloadRetryable, prepareDownloadRetry } = require('./downloadRetry');
const { isDownloadResumable, prepareDownloadResume } = require('./downloadResume');
const {
    isDownloadMediaDeletable,
    getDownloadDeletionPlan,
    getDownloadDestinationPathKeys,
    getSharedDownloadDestinationRecords,
    getSharedDownloadArtifactRecords,
    getSharedDownloadPartialOwnerRecords,
    hasExistingDownloadArtifacts,
    deleteDownloadArtifacts
} = require('./downloadDeletion');
const {
    DownloadScheduler,
    UNLIMITED_CONCURRENT_DOWNLOADS,
    isValidMaxConcurrentDownloads,
    getConfiguredMaxConcurrentDownloads,
    sortQueuedDownloadRecords
} = require('./downloadScheduler');
const { createBackendSettings, BackendSettingsStore } = require('./backendSettingsStore');
const { AllDebridClient } = require('./allDebridClient');
const {
    REALDEBRID_OPEN_SOURCE_CLIENT_ID,
    RealDebridApiError,
    RealDebridClient
} = require('./realDebridClient');
const { AllDebridCleanupStore } = require('./allDebridCleanupStore');
const { AllDebridAvailabilityStore } = require('./allDebridAvailabilityStore');
const { AllDebridAvailabilityService } = require('./allDebridAvailability');
const { RealDebridCleanupStore } = require('./realDebridCleanupStore');
const { RealDebridAvailabilityStore } = require('./realDebridAvailabilityStore');
const { normalizeSource: normalizeRealDebridSource, RealDebridAvailabilityService } = require('./realDebridAvailability');
const {
    getConfiguredPlayerPath,
    validatePlayerExecutable,
    launchMediaFile
} = require('./playerLauncher');
const { selectPlayerExecutable } = require('./playerExecutableSelector');
const { MpcHcStatusClient } = require('./mpcHcStatusClient');
const { MpcHcPlaybackTracker } = require('./mpcHcPlaybackTracker');
const { PlaybackProgressStore } = require('./playbackProgressStore');
const { openDownloadLocation } = require('./fileExplorerLauncher');
const { DownloadRecordStore, recoverInterruptedDownloadRecords } = require('./downloadRecordStore');
const { STATUS_EVENT_TYPES, DownloadHistoryStore } = require('./downloadHistoryStore');

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
const REALDEBRID_STREAM_MARKER = /(?:^|[^a-z0-9])rd\s*(?:\+|download)(?:$|[^a-z0-9])/i;
const ALLDEBRID_ADDON_MARKER = /(?:all[\s._-]*debrid|(?:^|[\s([_-])ad(?:$|[\s)\]_-]))/i;
const REALDEBRID_ADDON_MARKER = /(?:real[\s._-]*debrid|(?:^|[\s([_-])rd(?:$|[\s)\]_-]))/i;
const DEBRID_PROVIDER = Object.freeze({
    ALLDEBRID: 'alldebrid',
    REALDEBRID: 'realdebrid',
    UNKNOWN: 'unknown'
});
const BLOCKED_SOURCE_READINESS = new Set(['requires_caching', 'unavailable']);

const app = express();
const downloads = new Map();
const downloadMutationIds = new Set();
const deletingArtifactPathKeys = new Set();
const recordStore = new DownloadRecordStore({
    onError: (error) => console.error('Could not persist download records:', error)
});
const historyStore = new DownloadHistoryStore({
    onWarning: (message) => console.warn(message)
});
const downloadScheduler = new DownloadScheduler({
    maxConcurrentDownloads: getConfiguredMaxConcurrentDownloads(),
    onTaskError: (error, recordId) => console.error(`Scheduled download ${recordId} failed unexpectedly:`, error)
});
const settingsStore = new BackendSettingsStore();
const playbackProgressStore = new PlaybackProgressStore({
    onError: (error) => console.error('Could not persist playback progress:', error)
});
const mpcHcStatusClient = new MpcHcStatusClient();
const mpcHcPlaybackTracker = new MpcHcPlaybackTracker({
    client: mpcHcStatusClient,
    store: playbackProgressStore,
    onWarning: (message) => console.warn(message)
});
const allDebridClient = new AllDebridClient();
const realDebridClient = new RealDebridClient();
const allDebridCleanupStore = new AllDebridCleanupStore();
const allDebridAvailabilityStore = new AllDebridAvailabilityStore();
const realDebridCleanupStore = new RealDebridCleanupStore();
const realDebridAvailabilityStore = new RealDebridAvailabilityStore();
const allDebridAvailability = new AllDebridAvailabilityService({
    client: allDebridClient,
    cleanupStore: allDebridCleanupStore,
    historyStore: allDebridAvailabilityStore,
    onWarning: (message) => console.warn(message)
});
const realDebridAvailability = new RealDebridAvailabilityService({
    client: realDebridClient,
    cleanupStore: realDebridCleanupStore,
    historyStore: realDebridAvailabilityStore,
    onWarning: (message) => console.warn(message)
});
let backendSettings = createBackendSettings(downloadScheduler.maxConcurrentDownloads);
let allDebridPinSession = null;
let realDebridDeviceSession = null;
let realDebridRefreshPromise = null;
let allDebridPendingCleanupCount = 0;
let realDebridPendingCleanupCount = 0;
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

const detectProviderInText = (text, allDebridPattern, realDebridPattern) => {
    const allDebrid = allDebridPattern.test(text);
    const realDebrid = realDebridPattern.test(text);
    if (allDebrid === realDebrid) {
        return DEBRID_PROVIDER.UNKNOWN;
    }
    return allDebrid ? DEBRID_PROVIDER.ALLDEBRID : DEBRID_PROVIDER.REALDEBRID;
};

const getRecordDebridProvider = (record) => {
    if ([DEBRID_PROVIDER.ALLDEBRID, DEBRID_PROVIDER.REALDEBRID].includes(record?.debridProvider)) {
        return record.debridProvider;
    }
    const streamText = [record?.streamName, record?.streamDescription]
        .filter((value) => typeof value === 'string')
        .join('\n');
    const streamProvider = detectProviderInText(streamText, ALLDEBRID_STREAM_MARKER, REALDEBRID_STREAM_MARKER);
    if (streamProvider !== DEBRID_PROVIDER.UNKNOWN) {
        return streamProvider;
    }
    return detectProviderInText(String(record?.addonName || ''), ALLDEBRID_ADDON_MARKER, REALDEBRID_ADDON_MARKER);
};

const isAllDebridResolverRecord = (record) => {
    return Boolean(record?.infoHash) && getRecordDebridProvider(record) === DEBRID_PROVIDER.ALLDEBRID;
};

const getPersistedProviderStatus = async (payload) => {
    const provider = getRecordDebridProvider(payload);
    if (provider === DEBRID_PROVIDER.ALLDEBRID && typeof payload?.infoHash === 'string') {
        const history = await allDebridAvailability.getHistory([payload.infoHash]);
        return history.items[0]?.status ?? 'unknown';
    }
    if (provider === DEBRID_PROVIDER.REALDEBRID && typeof payload?.infoHash === 'string') {
        try {
            const source = normalizeRealDebridSource({
                hash: payload.infoHash,
                fileIdx: payload.fileIdx,
                filename: payload.behaviorHints?.filename ?? payload.fileName,
                videoSize: payload.behaviorHints?.videoSize
            });
            const history = await realDebridAvailability.getHistory([source]);
            return history.items[0]?.status ?? 'unknown';
        } catch {
            return 'unknown';
        }
    }
    return 'unknown';
};

const getBlockedSourceMessage = (provider, readiness) => {
    const providerName = provider === DEBRID_PROVIDER.REALDEBRID ? 'Real-Debrid' :
        provider === DEBRID_PROVIDER.ALLDEBRID ? 'AllDebrid' : 'debrid provider';
    return readiness === 'unavailable' ?
        `This source is unavailable on ${providerName}. Choose a cached source instead.`
        :
        `This source is not cached on ${providerName}. Choose a cached source or try again later.`;
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
        debridProvider: getRecordDebridProvider(payload),
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
        localFileIdentity: null,
        partialFileIdentity: null,
        attemptCount: 1,
        lastAttemptAt: now
    };
};

const getPersistableDownloadRecords = () => Array.from(downloads.values()).filter((record) => record.status !== 'deleted');

const scheduleDownloadRecordsPersistence = () => {
    recordStore.schedule(getPersistableDownloadRecords());
};

const persistDownloadRecordsNow = () => recordStore.flush(getPersistableDownloadRecords());

const appendDownloadHistory = (eventType, record, details = {}, options = {}) => historyStore.append({
    eventType,
    eventKey: options.eventKey,
    downloadId: record.id,
    occurredAt: options.occurredAt,
    record,
    details
});

const appendDownloadHistorySafely = async (eventType, record, details = {}, options = {}) => {
    try {
        return await appendDownloadHistory(eventType, record, details, options);
    } catch (error) {
        console.error(`Could not append ${eventType} history for download ${record?.id || 'unknown'}:`, error);
        return null;
    }
};

const scheduleDownloadHistoryTransition = (previousRecord, nextRecord) => {
    const eventType = previousRecord?.status !== nextRecord?.status ? STATUS_EVENT_TYPES[nextRecord?.status] : null;
    if (!eventType) {
        return;
    }
    appendDownloadHistorySafely(eventType, nextRecord, {
        previousStatus: previousRecord.status,
        status: nextRecord.status
    });
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
    scheduleDownloadHistoryTransition(record, nextRecord);
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

const withExclusiveDownloadMutation = (handler) => async (request, response, next) => {
    const recordId = request.params.id;
    if (downloadMutationIds.has(recordId)) {
        response.status(409).json({
            ok: false,
            errorCode: 'DOWNLOAD_OPERATION_IN_PROGRESS',
            error: 'Another operation is already changing this download. Wait for it to finish and try again.'
        });
        return;
    }

    const record = downloads.get(recordId);
    if (record) {
        try {
            if (getDownloadDestinationPathKeys(record).some((pathKey) => deletingArtifactPathKeys.has(pathKey))) {
                response.status(409).json({
                    ok: false,
                    errorCode: 'DOWNLOAD_DESTINATION_DELETING',
                    error: 'Another operation is deleting this download destination. Wait for it to finish and try again.'
                });
                return;
            }
        } catch {
            // The route-specific path validation will return the more precise error.
        }
    }

    downloadMutationIds.add(recordId);
    try {
        await handler(request, response);
    } catch (error) {
        next(error);
    } finally {
        downloadMutationIds.delete(recordId);
    }
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

    const isRealDebridResolver = getRecordDebridProvider(record) === DEBRID_PROVIDER.REALDEBRID &&
        Boolean(record.infoHash) && Boolean(backendSettings.debrid.realDebrid?.refreshToken);
    let realDebridAccessToken = null;
    let preexistingTorrentIds = null;
    if (isRealDebridResolver) {
        try {
            realDebridAccessToken = await getFreshRealDebridAccessToken();
            preexistingTorrentIds = await realDebridAvailability.snapshotMatchingIds(realDebridAccessToken, record.infoHash);
        } catch (error) {
            console.warn(`Could not snapshot Real-Debrid torrents before download ${record.id}: ${error.message || 'unknown error'}`);
        }
    }

    try {
        await startDownload(record, updateDownloadRecordById, options);
        const completedRecord = downloads.get(record.id);
        if (isAllDebridResolver && completedRecord?.status === 'completed') {
            await allDebridAvailability.recordObservation(record.infoHash, 'cached', 'completed_download').catch((error) => {
                console.warn(`Could not save cached AllDebrid history for download ${record.id}: ${error.message || 'unknown error'}`);
            });
        } else if (isAllDebridResolver && completedRecord?.status === 'failed') {
            if (preexistingMagnetIds !== null) {
                await allDebridAvailability.cleanupNewMagnetsForHash(apiKey, record.infoHash, preexistingMagnetIds)
                    .then((cleanup) => {
                        allDebridPendingCleanupCount = cleanup.pending;
                    })
                    .catch((error) => {
                        console.warn(`Could not identify or clean up AllDebrid magnets for download ${record.id}: ${error.message || 'unknown error'}`);
                    });
            }
            const failedStatus = completedRecord.errorCode === 'SOURCE_NOT_READY' ? 'uncached' : 'unavailable';
            await allDebridAvailability.recordObservation(record.infoHash, failedStatus, 'failed_download').catch((error) => {
                console.warn(`Could not save failed AllDebrid history for download ${record.id}: ${error.message || 'unknown error'}`);
            });
        }
        if (isRealDebridResolver && completedRecord?.status === 'completed') {
            try {
                const source = normalizeRealDebridSource({
                    hash: record.infoHash,
                    fileIdx: record.fileIdx,
                    filename: record.behaviorHints?.filename ?? record.fileName,
                    videoSize: record.behaviorHints?.videoSize
                });
                await realDebridAvailability.recordObservation(source, 'cached', 'completed_download');
            } catch (error) {
                console.warn(`Could not save cached Real-Debrid history for download ${record.id}: ${error.message || 'unknown error'}`);
            }
        } else if (isRealDebridResolver && completedRecord?.status === 'failed') {
            if (realDebridAccessToken && preexistingTorrentIds !== null) {
                await realDebridAvailability.reconcileNewTorrents(realDebridAccessToken, record.infoHash, preexistingTorrentIds)
                    .then(async () => {
                        realDebridPendingCleanupCount = await realDebridAvailability.getPendingCleanupCount();
                    })
                    .catch((error) => {
                        console.warn(`Could not identify or clean up Real-Debrid torrents for download ${record.id}: ${error.message || 'unknown error'}`);
                    });
            }
            try {
                const source = normalizeRealDebridSource({
                    hash: record.infoHash,
                    fileIdx: record.fileIdx,
                    filename: record.behaviorHints?.filename ?? record.fileName,
                    videoSize: record.behaviorHints?.videoSize
                });
                await realDebridAvailability.recordObservation(
                    source,
                    completedRecord.errorCode === 'SOURCE_NOT_READY' ? 'uncached' : 'unavailable',
                    'failed_download'
                );
            } catch (error) {
                console.warn(`Could not save failed Real-Debrid history for download ${record.id}: ${error.message || 'unknown error'}`);
            }
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
        await Promise.all([
            persistDownloadRecordsNow().catch((error) => {
                console.error('Could not persist final download state:', error);
            }),
            historyStore.flush().catch((error) => {
                console.error('Could not flush final download history:', error);
            })
        ]);
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
    if (!record) {
        return record;
    }

    const decoratedRecord = {
        ...record,
        sharedDestinationCount: getSharedDownloadDestinationRecords(record, downloads.values()).length,
        sharedPartialOwnerCount: getSharedDownloadPartialOwnerRecords(record, downloads.values()).length
    };
    if (record.status !== 'queued') {
        return decoratedRecord;
    }

    const queuePosition = queueMetadata.positions.get(record.id);
    return {
        ...decoratedRecord,
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

const getRealDebridConnectionResponse = () => {
    const settings = backendSettings.debrid.realDebrid;
    return {
        connected: Boolean(settings?.clientId && settings?.clientSecret && settings?.refreshToken),
        userId: settings?.userId ?? null,
        username: settings?.username ?? null,
        isPremium: settings?.isPremium === true,
        premiumUntil: settings?.premiumUntil ?? null,
        pendingCleanup: realDebridPendingCleanupCount
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
        executablePath: backendSettings.player.executablePath,
        progressTracking: backendSettings.player.progressTracking
    },
    debrid: {
        allDebrid: getAllDebridConnectionResponse(),
        realDebrid: getRealDebridConnectionResponse()
    }
});

const saveAllDebridConnection = async (allDebrid) => {
    backendSettings = await settingsStore.save(createBackendSettings(
        backendSettings.downloads.maxConcurrentDownloads,
        allDebrid,
        backendSettings.player.executablePath,
        backendSettings.debrid.realDebrid,
        backendSettings.player.progressTracking
    ));
    return getAllDebridConnectionResponse();
};

const saveRealDebridConnection = async (realDebrid) => {
    backendSettings = await settingsStore.save(createBackendSettings(
        backendSettings.downloads.maxConcurrentDownloads,
        backendSettings.debrid.allDebrid,
        backendSettings.player.executablePath,
        realDebrid,
        backendSettings.player.progressTracking
    ));
    return getRealDebridConnectionResponse();
};

const createRealDebridSettings = ({ credentials, token, user, previousSettings = null }) => {
    const expiresIn = Number(token?.expires_in);
    if (!credentials?.client_id || !credentials?.client_secret || !token?.access_token ||
        !(token?.refresh_token || previousSettings?.refreshToken) || !Number.isFinite(expiresIn) || expiresIn <= 0) {
        throw new RealDebridApiError('Real-Debrid returned incomplete authorization credentials');
    }

    const premiumSeconds = Number(user?.premium);
    return {
        clientId: credentials.client_id,
        clientSecret: credentials.client_secret,
        accessToken: token.access_token,
        refreshToken: token.refresh_token || previousSettings.refreshToken,
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
        userId: user?.id ?? previousSettings?.userId ?? null,
        username: user?.username ?? previousSettings?.username ?? null,
        isPremium: user?.type === 'premium' && Number.isFinite(premiumSeconds) && premiumSeconds > 0,
        premiumUntil: user?.expiration ?? previousSettings?.premiumUntil ?? null
    };
};

const getFreshRealDebridAccessToken = async () => {
    const settings = backendSettings.debrid.realDebrid;
    if (!settings?.clientId || !settings?.clientSecret || !settings?.refreshToken) {
        const error = new RealDebridApiError('Connect Real-Debrid before using this action', {
            code: 'REALDEBRID_NOT_CONNECTED'
        });
        throw error;
    }
    if (settings.accessToken && Date.parse(settings.tokenExpiresAt) > Date.now() + 60000) {
        return settings.accessToken;
    }
    if (!realDebridRefreshPromise) {
        realDebridRefreshPromise = (async () => {
            const token = await realDebridClient.refreshAccessToken(
                settings.clientId,
                settings.clientSecret,
                settings.refreshToken
            );
            const user = await realDebridClient.getUser(token.access_token);
            await saveRealDebridConnection(createRealDebridSettings({
                credentials: { client_id: settings.clientId, client_secret: settings.clientSecret },
                token,
                user,
                previousSettings: settings
            }));
            return backendSettings.debrid.realDebrid.accessToken;
        })().finally(() => {
            realDebridRefreshPromise = null;
        });
    }
    return realDebridRefreshPromise;
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

const sendRealDebridError = (response, error, fallbackMessage) => {
    const authenticationError = ['REALDEBRID_BAD_TOKEN', 'REALDEBRID_NOT_CONNECTED'].includes(error?.code);
    const invalidRequest = ['REALDEBRID_INVALID_SOURCE', 'REALDEBRID_INVALID_SOURCES', 'REALDEBRID_TOO_MANY_SOURCES'].includes(error?.code);
    const status = authenticationError ? 401 : invalidRequest ? 400 : error?.status === 404 ? 404 : 502;
    response.status(status).json({
        ok: false,
        errorCode: error?.code || 'REALDEBRID_REQUEST_FAILED',
        providerCode: error?.providerCode ?? null,
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
    const hasDownloadsUpdate = Object.prototype.hasOwnProperty.call(request.body?.downloads || {}, 'maxConcurrentDownloads');
    const hasProgressUpdate = Object.prototype.hasOwnProperty.call(request.body?.player || {}, 'progressTracking');
    if (!hasDownloadsUpdate && !hasProgressUpdate) {
        response.status(400).json({
            ok: false,
            error: 'Provide a supported download or player setting to update'
        });
        return;
    }

    const maxConcurrentDownloads = hasDownloadsUpdate ?
        request.body.downloads.maxConcurrentDownloads
        : backendSettings.downloads.maxConcurrentDownloads;
    if (!isValidMaxConcurrentDownloads(maxConcurrentDownloads)) {
        response.status(400).json({
            ok: false,
            error: `downloads.maxConcurrentDownloads must be a positive safe integer or "${UNLIMITED_CONCURRENT_DOWNLOADS}"`
        });
        return;
    }

    try {
        const nextSettings = createBackendSettings(
            maxConcurrentDownloads,
            backendSettings.debrid.allDebrid,
            backendSettings.player.executablePath,
            backendSettings.debrid.realDebrid,
            hasProgressUpdate ? request.body.player.progressTracking : backendSettings.player.progressTracking
        );
        backendSettings = await settingsStore.save(nextSettings);
    } catch (error) {
        const invalidSettings = error?.code === 'BACKEND_SETTINGS_INVALID';
        console.error('Could not persist backend settings:', error);
        response.status(invalidSettings ? 400 : 500).json({
            ok: false,
            errorCode: error?.code || 'BACKEND_SETTINGS_SAVE_FAILED',
            error: invalidSettings ? error.message : 'Could not save local download settings'
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
            executablePath,
            backendSettings.debrid.realDebrid,
            backendSettings.player.progressTracking
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

app.post('/settings/player/progress/test', requireTrustedLocalOrigin, async (request, response) => {
    const port = request.body?.port ?? backendSettings.player.progressTracking.port;
    try {
        const status = await mpcHcStatusClient.getStatus(port);
        response.json({
            ok: true,
            connected: true,
            port: Number(port),
            playerActive: Boolean(status.filePath),
            state: status.state,
            positionMs: status.positionMs,
            durationMs: status.durationMs
        });
    } catch (error) {
        const invalidPort = error?.code === 'MPC_HC_PORT_INVALID';
        response.status(invalidPort ? 400 : 503).json({
            ok: false,
            connected: false,
            errorCode: error?.code || 'MPC_HC_CONNECTION_FAILED',
            error: invalidPort ? error.message : 'Could not connect to the MPC-HC Web Interface on this port'
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

app.post('/debrid/realdebrid/auth/device', async (request, response) => {
    try {
        const device = await realDebridClient.getDeviceCode(REALDEBRID_OPEN_SOURCE_CLIENT_ID);
        const expiresIn = Number(device?.expires_in);
        const intervalSeconds = Number(device?.interval);
        if (!device?.device_code || !device?.user_code || !device?.verification_url) {
            throw new RealDebridApiError('Real-Debrid returned an incomplete device authorization response');
        }
        const expiresAt = new Date(Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 1800) * 1000).toISOString();
        realDebridDeviceSession = {
            clientId: REALDEBRID_OPEN_SOURCE_CLIENT_ID,
            deviceCode: device.device_code,
            userCode: device.user_code,
            verificationUrl: device.verification_url,
            expiresAt,
            intervalSeconds: Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds : 5
        };
        response.status(201).json({
            userCode: realDebridDeviceSession.userCode,
            verificationUrl: realDebridDeviceSession.verificationUrl,
            expiresAt,
            intervalSeconds: realDebridDeviceSession.intervalSeconds
        });
    } catch (error) {
        sendRealDebridError(response, error, 'Could not start Real-Debrid authorization');
    }
});

app.post('/debrid/realdebrid/auth/device/check', async (request, response) => {
    if (!realDebridDeviceSession) {
        response.status(409).json({ ok: false, error: 'No Real-Debrid device connection is in progress' });
        return;
    }
    if (Date.parse(realDebridDeviceSession.expiresAt) <= Date.now()) {
        realDebridDeviceSession = null;
        response.status(410).json({ ok: false, error: 'The Real-Debrid authorization code expired. Start a new connection.' });
        return;
    }

    try {
        const session = realDebridDeviceSession;
        const credentials = await realDebridClient.getDeviceCredentials(session.clientId, session.deviceCode);
        if (!credentials?.client_id || !credentials?.client_secret) {
            response.json({ activated: false, expiresAt: session.expiresAt });
            return;
        }

        const token = await realDebridClient.getToken(credentials.client_id, credentials.client_secret, session.deviceCode);
        const user = await realDebridClient.getUser(token.access_token);
        const connection = await saveRealDebridConnection(createRealDebridSettings({ credentials, token, user }));
        realDebridDeviceSession = null;
        response.json({ activated: true, connection });
    } catch (error) {
        sendRealDebridError(response, error, 'Could not complete Real-Debrid authorization');
    }
});

app.delete('/debrid/realdebrid/auth', async (request, response) => {
    try {
        if (backendSettings.debrid.realDebrid) {
            const accessToken = await getFreshRealDebridAccessToken();
            const cleanup = await realDebridAvailability.retryPendingCleanup(accessToken);
            realDebridPendingCleanupCount = cleanup.pending;
            if (realDebridPendingCleanupCount > 0) {
                response.status(409).json({
                    ok: false,
                    error: 'Temporary Real-Debrid torrents still need cleanup. Keep the connection and try again.'
                });
                return;
            }
            await realDebridClient.disableAccessToken(accessToken);
        } else {
            realDebridPendingCleanupCount = await realDebridAvailability.getPendingCleanupCount();
        }
        await saveRealDebridConnection(null);
        realDebridDeviceSession = null;
        realDebridAvailability.clearCache();
        response.json({ ok: true, connection: getRealDebridConnectionResponse() });
    } catch (error) {
        sendRealDebridError(response, error, 'Could not disconnect Real-Debrid');
    }
});

app.post('/debrid/realdebrid/availability', async (request, response) => {
    try {
        const accessToken = await getFreshRealDebridAccessToken();
        const result = await realDebridAvailability.check(accessToken, request.body?.sources);
        realDebridPendingCleanupCount = result.pendingCleanup;
        response.json({
            provider: 'realdebrid',
            connected: true,
            ...result
        });
    } catch (error) {
        realDebridPendingCleanupCount = await realDebridAvailability.getPendingCleanupCount().catch(() => realDebridPendingCleanupCount);
        sendRealDebridError(response, error, 'Could not check Real-Debrid availability');
    }
});

app.post('/debrid/realdebrid/availability/head', async (request, response) => {
    try {
        const accessToken = await getFreshRealDebridAccessToken();
        const result = await realDebridAvailability.probe(accessToken, request.body?.source);
        realDebridPendingCleanupCount = result.pendingCleanup;
        response.json({
            provider: 'realdebrid',
            connected: true,
            ...result
        });
    } catch (error) {
        realDebridPendingCleanupCount = await realDebridAvailability.getPendingCleanupCount().catch(() => realDebridPendingCleanupCount);
        sendRealDebridError(response, error, 'Could not probe the Real-Debrid resolver link');
    }
});

app.post('/debrid/realdebrid/availability/history', async (request, response) => {
    try {
        const result = await realDebridAvailability.getHistory(request.body?.sources);
        response.json({
            provider: 'realdebrid',
            connected: Boolean(backendSettings.debrid.realDebrid?.refreshToken),
            ...result
        });
    } catch (error) {
        sendRealDebridError(response, error, 'Could not read Real-Debrid availability history');
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

    let persistedProviderStatus = 'unknown';
    try {
        persistedProviderStatus = await getPersistedProviderStatus(payload);
    } catch (error) {
        console.warn(`Could not read provider availability history before download: ${error.message || 'unknown error'}`);
    }
    const effectiveBlockedReadiness = BLOCKED_SOURCE_READINESS.has(payload.sourceReadiness) ?
        payload.sourceReadiness
        :
        persistedProviderStatus === 'uncached' ? 'requires_caching' :
            persistedProviderStatus === 'unavailable' ? 'unavailable' : null;

    const placeholder = classifyKnownPlaceholderSourceUrl(sourceUrl);
    if (effectiveBlockedReadiness || placeholder) {
        const provider = getRecordDebridProvider(payload);
        response.status(409).json({
            ok: false,
            errorCode: effectiveBlockedReadiness === 'unavailable' || placeholder?.status === 'unavailable' ?
                'SOURCE_UNAVAILABLE'
                :
                'SOURCE_NOT_READY',
            error: effectiveBlockedReadiness ?
                getBlockedSourceMessage(provider, effectiveBlockedReadiness)
                : placeholder?.status === 'unavailable' ?
                    'This debrid source was rejected or removed by the provider. Choose another cached source.'
                    :
                    'This debrid source is not ready. Choose a verified cached source or try again later.'
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
    let destinationPathKeys;
    try {
        destinationPathKeys = getDownloadDestinationPathKeys(record);
    } catch (error) {
        response.status(400).json({
            ok: false,
            errorCode: error?.code || 'DOWNLOAD_DESTINATION_INVALID',
            error: error?.message || 'Could not safely derive the download destination'
        });
        return;
    }
    if (destinationPathKeys.some((pathKey) => deletingArtifactPathKeys.has(pathKey))) {
        response.status(409).json({
            ok: false,
            errorCode: 'DOWNLOAD_DESTINATION_DELETING',
            error: 'A previous download with this destination is currently being deleted. Wait for deletion to finish and try again.'
        });
        return;
    }
    const destinationConflict = Array.from(downloads.values()).find((existingRecord) => {
        if (!existingRecord || existingRecord.status === 'deleted') {
            return false;
        }
        try {
            return getDownloadDestinationPathKeys(existingRecord).some((pathKey) => destinationPathKeys.includes(pathKey));
        } catch {
            return false;
        }
    });
    if (destinationConflict) {
        response.status(409).json({
            ok: false,
            errorCode: 'DOWNLOAD_DESTINATION_CONFLICT',
            error: 'Another download record already owns this local destination. Remove or resolve that record before downloading another source.',
            conflictingDownloadId: destinationConflict.id
        });
        return;
    }
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

    await appendDownloadHistorySafely('download_created', record, { status: record.status }, {
        eventKey: `record-seen:${record.id}`,
        occurredAt: record.createdAt
    });

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

app.get('/downloads/history', async (request, response) => {
    const requestedLimit = request.query.limit === undefined ? undefined : Number(request.query.limit);
    if (requestedLimit !== undefined && (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1)) {
        response.status(400).json({
            ok: false,
            error: 'limit must be a positive integer'
        });
        return;
    }

    try {
        response.json(await historyStore.list({ limit: requestedLimit }));
    } catch (error) {
        console.error('Could not read download history:', error);
        response.status(500).json({
            ok: false,
            error: 'Could not read the local download history'
        });
    }
});

app.get('/downloads/:id', (request, response) => {
    const record = getDownloadRecordOrSend404(request.params.id, response);
    if (!record) {
        return;
    }

    response.json(getDownloadRecordResponse(record));
});

app.patch('/downloads/:id/queue', withExclusiveDownloadMutation(async (request, response) => {
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
}));

app.post('/downloads/:id/pause', withExclusiveDownloadMutation(async (request, response) => {
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
}));

app.post('/downloads/:id/resume', withExclusiveDownloadMutation(async (request, response) => {
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
            'DOWNLOAD_PARTIAL_FILE_TOO_LARGE',
            'DOWNLOAD_PARTIAL_IDENTITY_UNRECORDED',
            'DOWNLOAD_PARTIAL_IDENTITY_MISMATCH'
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

    await appendDownloadHistorySafely('download_resumed', resumePreparation.record, {
        previousStatus: record.status,
        status: resumePreparation.record.status,
        resumeOffset: resumePreparation.resumeOffset
    });

    enqueueDownload(resumePreparation.record, { resumeOffset: resumePreparation.resumeOffset });
    response.status(202).json(getDownloadRecordResponse(downloads.get(record.id) || resumePreparation.record));
}));

app.post('/downloads/:id/retry', withExclusiveDownloadMutation(async (request, response) => {
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

    let sharedRecords;
    try {
        sharedRecords = getSharedDownloadArtifactRecords(record, downloads.values());
    } catch (error) {
        response.status(500).json({
            ok: false,
            errorCode: error?.code || 'DOWNLOAD_RETRY_PATH_VALIDATION_FAILED',
            error: error?.message || 'Could not safely validate the retry destination'
        });
        return;
    }
    if (sharedRecords.length > 0) {
        response.status(409).json({
            ok: false,
            errorCode: 'DOWNLOAD_MEDIA_SHARED_RECORDS',
            error: 'Another download record uses this local destination. Remove the duplicate record before retrying.',
            sharedRecordIds: sharedRecords.map((sharedRecord) => sharedRecord.id)
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

    await appendDownloadHistorySafely('download_retried', retriedRecord, {
        previousStatus: record.status,
        status: retriedRecord.status
    });

    enqueueDownload(retriedRecord);
    response.status(202).json(getDownloadRecordResponse(downloads.get(record.id) || retriedRecord));
}));

app.post('/downloads/:id/cancel', withExclusiveDownloadMutation(async (request, response) => {
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
}));

app.delete('/downloads/:id', withExclusiveDownloadMutation(async (request, response) => {
    const record = getDownloadRecordOrSend404(request.params.id, response);
    if (!record) {
        return;
    }

    if (downloadScheduler.isQueued(record.id) || isDownloadActive(record.id) || ['queued', 'downloading', 'paused'].includes(record.status)) {
        response.status(409).json({
            ok: false,
            errorCode: 'DOWNLOAD_RECORD_ACTIVE',
            error: record.status === 'paused' ?
                'Delete the partial download data or cancel it before removing its record.'
                :
                'Pause or cancel this download before removing its record.'
        });
        return;
    }
    const sharedPartialOwnerRecords = getSharedDownloadPartialOwnerRecords(record, downloads.values());
    if (record.partialPath && sharedPartialOwnerRecords.length === 0) {
        response.status(409).json({
            ok: false,
            errorCode: 'DOWNLOAD_PARTIAL_DATA_REQUIRES_DELETE',
            error: 'This record owns partial download data. Use Delete partial data so it is not orphaned.'
        });
        return;
    }

    try {
        await appendDownloadHistory('record_removal_requested', record, {
            previousStatus: record.status,
            remainingSharedRecordCount: sharedPartialOwnerRecords.length
        });
    } catch (error) {
        console.error(`Could not preserve removal history for download ${record.id}:`, error);
        response.status(500).json({
            ok: false,
            errorCode: 'DOWNLOAD_HISTORY_WRITE_FAILED',
            error: 'The saved record was not removed because its permanent history could not be written.'
        });
        return;
    }

    downloads.delete(record.id);

    try {
        await persistDownloadRecordsNow();
    } catch (error) {
        downloads.set(record.id, record);
        console.error('Could not persist removed download record:', error);
        response.status(500).json({
            ok: false,
            error: 'Could not remove the saved download record'
        });
        return;
    }

    await appendDownloadHistorySafely('record_removed', record, {
        previousStatus: record.status,
        remainingSharedRecordCount: sharedPartialOwnerRecords.length
    });

    response.json({
        ok: true,
        id: record.id,
        status: 'deleted',
        remainingSharedRecordIds: sharedPartialOwnerRecords.map((sharedRecord) => sharedRecord.id)
    });
}));

app.delete('/downloads/:id/media', withExclusiveDownloadMutation(async (request, response) => {
    const record = getDownloadRecordOrSend404(request.params.id, response);
    if (!record) {
        return;
    }
    if (downloadScheduler.isQueued(record.id) || isDownloadActive(record.id) || !isDownloadMediaDeletable(record)) {
        response.status(409).json({
            ok: false,
            errorCode: 'DOWNLOAD_MEDIA_NOT_DELETABLE',
            error: 'Pause or cancel an active download before deleting its local data.'
        });
        return;
    }

    let deletionPathKeys;
    try {
        getDownloadDeletionPlan(record);
        deletionPathKeys = getDownloadDestinationPathKeys(record);
    } catch (error) {
        console.error(`Could not validate local data paths for download ${record.id}:`, error);
        response.status(500).json({
            ok: false,
            errorCode: error?.code || 'DOWNLOAD_DELETE_PATH_VALIDATION_FAILED',
            error: error?.message || 'Could not safely validate the local download paths'
        });
        return;
    }
    if (deletionPathKeys.some((pathKey) => deletingArtifactPathKeys.has(pathKey))) {
        response.status(409).json({
            ok: false,
            errorCode: 'DOWNLOAD_DESTINATION_DELETING',
            error: 'Another download using this destination is currently being deleted. Wait for it to finish and try again.'
        });
        return;
    }
    deletionPathKeys.forEach((pathKey) => deletingArtifactPathKeys.add(pathKey));

    try {
        let artifactsExist;
        try {
            artifactsExist = await hasExistingDownloadArtifacts(record);
        } catch (error) {
            console.error(`Could not inspect local data for download ${record.id}:`, error);
            response.status(500).json({
                ok: false,
                errorCode: error?.code || 'DOWNLOAD_ARTIFACT_INSPECTION_FAILED',
                error: error?.message || 'Could not safely inspect the local download data'
            });
            return;
        }

        if (artifactsExist) {
            const sharedRecords = getSharedDownloadArtifactRecords(record, downloads.values());
            if (sharedRecords.length > 0) {
                response.status(409).json({
                    ok: false,
                    errorCode: 'DOWNLOAD_MEDIA_SHARED_RECORDS',
                    error: `This local file is referenced by ${sharedRecords.length + 1} download records. Remove the duplicate records first, then delete the remaining download.`,
                    sharedRecordIds: sharedRecords.map((sharedRecord) => sharedRecord.id)
                });
                return;
            }
        }

        try {
            await appendDownloadHistory('media_deletion_requested', record, {
                previousStatus: record.status
            });
        } catch (error) {
            console.error(`Could not preserve media deletion history for download ${record.id}:`, error);
            response.status(500).json({
                ok: false,
                errorCode: 'DOWNLOAD_HISTORY_WRITE_FAILED',
                error: 'The local data was not deleted because its permanent history could not be written.'
            });
            return;
        }

        let deletion;
        try {
            deletion = await deleteDownloadArtifacts(record);
        } catch (error) {
            console.error(`Could not delete local data for download ${record.id}:`, error);
            const conflictCodes = new Set([
                'DOWNLOAD_MEDIA_NOT_DELETABLE',
                'DOWNLOAD_RECORDED_PATH_MISMATCH',
                'DOWNLOAD_FINAL_PATH_UNRECORDED',
                'DOWNLOAD_DELETE_ARTIFACT_INVALID',
                'DOWNLOAD_DELETE_PATH_UNSAFE',
                'DOWNLOAD_FILE_IDENTITY_UNRECORDED',
                'DOWNLOAD_FILE_IDENTITY_MISMATCH',
                'DOWNLOAD_DELETE_ARTIFACT_CHANGED'
            ]);
            response.status(conflictCodes.has(error?.code) ? 409 : 500).json({
                ok: false,
                errorCode: error?.code || 'DOWNLOAD_MEDIA_DELETE_FAILED',
                error: error?.message || 'Could not delete the local download data'
            });
            return;
        }

        downloads.delete(record.id);
        try {
            await persistDownloadRecordsNow();
        } catch (error) {
            const recoveryRecord = {
                ...record,
                status: 'failed',
                errorCode: 'DOWNLOAD_MEDIA_DELETED_RECORD_REMOVE_FAILED',
                error: 'The local media was deleted, but its saved record could not be removed. Try Delete download again.',
                updatedAt: getNowIso()
            };
            downloads.set(record.id, recoveryRecord);
            scheduleDownloadRecordsPersistence();
            console.error('Local media was deleted but its download record could not be removed:', error);
            response.status(500).json({
                ok: false,
                errorCode: 'DOWNLOAD_MEDIA_DELETED_RECORD_REMOVE_FAILED',
                error: recoveryRecord.error,
                deletedFiles: deletion.deletedFiles,
                bytesFreed: deletion.bytesFreed
            });
            return;
        }

        await appendDownloadHistorySafely('media_deleted', record, {
            previousStatus: record.status,
            bytesFreed: deletion.bytesFreed,
            deletedFileCount: deletion.deletedFiles.length
        });

        if (deletion.directoryCleanupWarning) {
            console.warn(`${deletion.directoryCleanupWarning} Download: ${record.id}`);
        }

        response.json({
            ok: true,
            id: record.id,
            status: 'deleted',
            deletedFiles: deletion.deletedFiles,
            bytesFreed: deletion.bytesFreed,
            removedDirectories: deletion.removedDirectories,
            directoryCleanupWarning: deletion.directoryCleanupWarning
        });
    } finally {
        deletionPathKeys.forEach((pathKey) => deletingArtifactPathKeys.delete(pathKey));
    }
}));

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
        let playbackSession = null;
        if (backendSettings.player.progressTracking.enabled) {
            try {
                playbackSession = mpcHcPlaybackTracker.start(record, {
                    port: backendSettings.player.progressTracking.port
                });
            } catch (trackingError) {
                console.warn(`Could not start playback tracking for ${record.id}: ${trackingError.message || 'unknown error'}`);
            }
        }
        response.json({
            ok: true,
            downloadId: record.id,
            localPath: launchResult.localPath,
            launched: true,
            playback: {
                enabled: backendSettings.player.progressTracking.enabled,
                sessionId: playbackSession?.id ?? null,
                state: playbackSession ? 'waiting_for_player' :
                    backendSettings.player.progressTracking.enabled ? 'unavailable' : 'disabled'
            }
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

app.get('/playback/progress', requireTrustedLocalOrigin, (request, response) => {
    const metaId = typeof request.query.metaId === 'string' && request.query.metaId.trim() ? request.query.metaId.trim() : null;
    const records = playbackProgressStore.list({ metaId }).map((record) => ({
        version: record.version,
        contentKey: record.contentKey,
        downloadId: record.downloadId,
        metaId: record.metaId,
        videoId: record.videoId,
        mediaType: record.mediaType,
        title: record.title,
        parentTitle: record.parentTitle,
        season: record.season,
        episode: record.episode,
        fileName: record.localPath ? path.win32.basename(record.localPath) : null,
        positionMs: record.positionMs,
        durationMs: record.durationMs,
        progress: record.progress,
        state: record.state,
        startedAt: record.startedAt,
        lastObservedAt: record.lastObservedAt,
        lastPlayedAt: record.lastPlayedAt,
        sessionEndedReason: record.sessionEndedReason,
        player: record.player
    }));
    response.json({ records });
});

const shutdown = async (signal) => {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;
    downloadScheduler.stop();
    mpcHcPlaybackTracker.stopAll('backend_shutdown');
    console.log(`${signal} received; saving download records before shutdown.`);

    if (httpServer !== null) {
        await new Promise((resolve) => httpServer.close(resolve));
    }

    try {
        await Promise.all([
            persistDownloadRecordsNow(),
            historyStore.flush(),
            playbackProgressStore.flush()
        ]);
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
    await playbackProgressStore.initialize();

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

    if (backendSettings.debrid.realDebrid?.refreshToken) {
        try {
            const accessToken = await getFreshRealDebridAccessToken();
            const cleanup = await realDebridAvailability.retryPendingCleanup(accessToken);
            realDebridPendingCleanupCount = cleanup.pending;
            if (cleanup.cleaned > 0) {
                console.log(`Cleaned up ${cleanup.cleaned} temporary Real-Debrid torrent(s) left by an interrupted check.`);
            }
        } catch (error) {
            realDebridPendingCleanupCount = await realDebridAvailability.getPendingCleanupCount().catch(() => 0);
            console.warn(`Could not retry pending Real-Debrid cleanup during startup: ${error.message || 'unknown error'}`);
        }
    } else {
        realDebridPendingCleanupCount = await realDebridAvailability.getPendingCleanupCount();
    }

    const storedRecords = await recordStore.load();
    const recovery = recoverInterruptedDownloadRecords(storedRecords);
    await historyStore.initialize();
    const backfilledHistoryCount = await historyStore.backfill(recovery.records);
    for (const interruptedRecord of storedRecords.filter((record) => record.status === 'downloading')) {
        const recoveredRecord = recovery.records.find((record) => record.id === interruptedRecord.id) || interruptedRecord;
        await appendDownloadHistorySafely('download_interrupted', recoveredRecord, {
            previousStatus: interruptedRecord.status,
            status: recoveredRecord.status
        });
    }
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
    if (backfilledHistoryCount > 0) {
        console.log(`Backfilled permanent history for ${backfilledHistoryCount} existing download record(s).`);
    }

    httpServer = app.listen(PORT, HOST, () => {
        console.log(`${SERVICE_NAME} listening on http://${HOST}:${PORT}`);
        console.log(`Download records: ${recordStore.filePath}`);
        console.log(`Download history: ${historyStore.filePath}`);
        console.log(`Backend settings: ${settingsStore.filePath}`);
        console.log(`Playback progress: ${playbackProgressStore.filePath}`);
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

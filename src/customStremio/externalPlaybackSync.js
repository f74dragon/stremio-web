const {
    buildStremioMetaItemSnapshot,
    buildLegacyStremioMetaItemSnapshot,
    validateStremioMetaItemSnapshot
} = require('./stremioMetaItemSnapshot');

const SYNC_LEDGER_PREFIX = 'customStremio.externalPlaybackSync.v1:';
const MIN_SYNC_INTERVAL_MS = 15000;
const POLL_INTERVAL_MS = 5000;
const METADATA_CACHE_MS = 5 * 60 * 1000;

let syncStatusSnapshot = { state: 'idle', lastSyncedAt: null, message: '' };
const statusListeners = new Set();
const publishStatus = (next) => {
    syncStatusSnapshot = { ...syncStatusSnapshot, ...next };
    statusListeners.forEach((listener) => listener());
};
const subscribeStatus = (listener) => {
    statusListeners.add(listener);
    return () => statusListeners.delete(listener);
};
const getStatus = () => syncStatusSnapshot;
const resetStatus = () => publishStatus({ state: 'idle', lastSyncedAt: null, message: '' });
const getAccountId = (ctx) => ctx?.profile?.auth?.user?._id || null;
const isSyncEnabled = (settings) => settings?.player?.progressTracking?.enabled === true &&
    settings.player.progressTracking.localhostOnlyConfirmed === true && settings.player.progressTracking.watchedSyncEnabled === true;

const readLedger = (storage, accountId) => {
    try {
        const value = JSON.parse(storage?.getItem(`${SYNC_LEDGER_PREFIX}${encodeURIComponent(accountId)}`) || '{}');
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
        return {};
    }
};
const writeLedger = (storage, accountId, ledger) => {
    try {
        const recent = Object.entries(ledger).sort(([, a], [, b]) => b.observedAt - a.observedAt).slice(0, 2000);
        storage?.setItem(`${SYNC_LEDGER_PREFIX}${encodeURIComponent(accountId)}`, JSON.stringify(Object.fromEntries(recent)));
    } catch {
        // The service retains its in-memory ledger if storage is unavailable.
    }
};

const getEligibleProgress = (downloads, records, ledger = {}, now = Date.now()) => {
    const byId = new Map((downloads || []).map((download) => [download?.id, download]));
    return (records || []).flatMap((progress) => {
        const download = byId.get(progress?.downloadId);
        const videoId = download?.videoId || (download?.type === 'movie' ? download.metaId : null);
        const contentKey = download?.metaId ? `${download.type}:${download.metaId}${download.videoId ? `:${download.videoId}` : ''}` : null;
        const observedAt = Date.parse(progress?.lastObservedAt);
        const position = progress?.positionMs;
        const duration = progress?.durationMs;
        const previous = ledger[contentKey];
        if (download?.status !== 'completed' || !['movie', 'series'].includes(download.type) || !download.metaId || !videoId ||
            progress?.metaId !== download.metaId || progress?.mediaType !== download.type ||
            (progress.videoId || (download.type === 'movie' ? download.metaId : null)) !== videoId ||
            progress.contentKey !== contentKey || progress.player?.kind !== 'mpc-hc' || progress.player?.telemetry !== 'web-interface' ||
            !Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(duration) || duration <= 0 || position > duration ||
            !Number.isFinite(observedAt) || observedAt > now + 60000 || observedAt <= (previous?.observedAt || 0)) {
            return [];
        }
        if (previous && ((previous.position === position && previous.duration === duration) ||
            (previous.completed && position / duration >= 0.9) ||
            (progress.state === 'playing' && position / duration < 0.9 && now - previous.syncedAt < MIN_SYNC_INTERVAL_MS))) {
            return [];
        }
        return [{ download, progress, contentKey, videoId, observedAt }];
    }).sort((a, b) => a.observedAt - b.observedAt);
};

const getMetadataUrl = (addon, type, id) => {
    const manifest = addon?.manifest;
    if (manifest?.types && !manifest.types.includes(type)) {
        return null;
    }
    const resource = manifest?.resources?.find((item) => item === 'meta' || item?.name === 'meta');
    if (!resource || (resource.types && !resource.types.includes(type))) {
        return null;
    }
    const prefixes = resource.idPrefixes || manifest.idPrefixes;
    if (prefixes?.length && !prefixes.some((prefix) => id.startsWith(prefix))) {
        return null;
    }
    try {
        const url = new URL(addon.transportUrl);
        if (!['https:', 'http:'].includes(url.protocol) || !/\/manifest\.json$/.test(url.pathname)) {
            return null;
        }
        url.pathname = `${url.pathname.slice(0, -'manifest.json'.length)}meta/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
        return url.toString();
    } catch {
        return null;
    }
};

const createMetadataResolver = ({ fetchFn = (...args) => fetch(...args), now = Date.now } = {}) => {
    const cache = new Map();
    return async (download, ctx) => {
        const saved = validateStremioMetaItemSnapshot(download.stremioMetaItem, { metaId: download.metaId, type: download.type }) ||
            buildLegacyStremioMetaItemSnapshot(download);
        if (download.type !== 'series') {
            return saved;
        }
        const key = `${getAccountId(ctx)}:${download.type}:${download.metaId}`;
        const cached = cache.get(key);
        if (cached && now() - cached.at < METADATA_CACHE_MS && cached.meta.videos.some((video) => video.id === download.videoId)) {
            return cached.meta;
        }
        for (const addon of ctx?.profile?.addons || []) {
            const url = getMetadataUrl(addon, download.type, download.metaId);
            if (!url) {
                continue;
            }
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 5000);
            try {
                const response = await fetchFn(url, { signal: controller.signal });
                if (!response.ok || Number(response.headers?.get('content-length')) > 2 * 1024 * 1024) {
                    continue;
                }
                const body = await response.text();
                if (body.length > 2 * 1024 * 1024) {
                    continue;
                }
                const meta = buildStremioMetaItemSnapshot(JSON.parse(body)?.meta);
                if (meta?.id === download.metaId && meta?.type === download.type && meta.videos?.some((video) => video.id === download.videoId)) {
                    cache.set(key, { at: now(), meta });
                    return meta;
                }
            } catch {
                // Try the next installed metadata addon, then the saved canonical snapshot.
            } finally {
                clearTimeout(timer);
            }
        }
        return saved?.videos?.some((video) => video.id === download.videoId) ? saved : null;
    };
};

const createExternalPlaybackSync = ({ core, accountId, backend, storage, now = Date.now,
    resolveMetadata = createMetadataResolver({ now }), onStatus = publishStatus }) => {
    const ledger = readLedger(storage, accountId);
    let stopped = false;
    let busy = false;
    let timer;
    const pendingAccountIds = new Set();
    let retryLibrarySync = false;
    let nextLibraryRetryAt = 0;
    const onCoreError = (source) => {
        if (stopped || !pendingAccountIds.size ||
            !['LibraryItemsPushedToAPI', 'LibrarySyncWithAPIPlanned'].includes(source?.event) ||
            (source.args?.ids && !source.args.ids.some((id) => pendingAccountIds.has(id)))) {
            return;
        }
        retryLibrarySync = true;
        nextLibraryRetryAt = now() + MIN_SYNC_INTERVAL_MS;
        onStatus({ state: 'retrying', message: 'Progress is saved locally. Account delivery will retry automatically.' });
    };
    const onCoreEvent = (name, args) => {
        if (stopped || name !== 'LibraryItemsPushedToAPI' || !args?.ids?.some((id) => pendingAccountIds.has(id))) {
            return;
        }
        args.ids.forEach((id) => pendingAccountIds.delete(id));
        if (!pendingAccountIds.size) {
            retryLibrarySync = false;
        }
        onStatus({ state: 'synced', lastSyncedAt: new Date(now()).toISOString(), message: '' });
    };
    const run = async () => {
        if (stopped || busy || !accountId) {
            return;
        }
        busy = true;
        try {
            const settings = await backend.getBackendSettings();
            if (stopped) {
                return;
            }
            if (!isSyncEnabled(settings)) {
                onStatus({ state: 'disabled', message: '' });
                return;
            }
            const [downloads, progress, ctx, player] = await Promise.all([
                backend.listDownloads(), backend.listPlaybackProgress(), core.transport.getState('ctx'), core.transport.getState('player')
            ]);
            if (stopped || getAccountId(ctx) !== accountId || player?.selected) {
                return;
            }
            if (retryLibrarySync && now() >= nextLibraryRetryAt) {
                retryLibrarySync = false;
                try {
                    await core.transport.dispatch({ action: 'Ctx', args: { action: 'SyncLibraryWithAPI' } });
                } catch (error) {
                    retryLibrarySync = true;
                    nextLibraryRetryAt = now() + MIN_SYNC_INTERVAL_MS;
                    throw error;
                }
            }
            const candidates = getEligibleProgress(downloads?.items, progress?.records, ledger, now());
            let waitingForMetadata = false;
            for (const candidate of candidates) {
                const meta = await resolveMetadata(candidate.download, ctx);
                if (stopped) {
                    return;
                }
                if (!meta || meta.id !== candidate.download.metaId || meta.type !== candidate.download.type ||
                    (meta.type === 'series' && !meta.videos?.some((video) => video.id === candidate.videoId))) {
                    waitingForMetadata = true;
                    continue;
                }
                // Recheck consent, account and native playback after asynchronous metadata reads.
                const [currentSettings, currentCtx, currentPlayer] = await Promise.all([
                    backend.getBackendSettings(), core.transport.getState('ctx'), core.transport.getState('player')
                ]);
                if (stopped || !isSyncEnabled(currentSettings) || getAccountId(currentCtx) !== accountId || currentPlayer?.selected) {
                    return;
                }
                const { progress: observation, contentKey, videoId, observedAt } = candidate;
                pendingAccountIds.add(candidate.download.metaId);
                await core.transport.dispatch({ action: 'Ctx', args: {
                    action: 'ExternalPlaybackProgressChanged', args: {
                        meta_item: meta,
                        video_id: videoId,
                        time: observation.positionMs,
                        duration: observation.durationMs,
                        observed_at: new Date(observedAt).toISOString()
                    }
                } });
                if (stopped) {
                    return;
                }
                ledger[contentKey] = { observedAt, position: observation.positionMs, duration: observation.durationMs,
                    completed: observation.positionMs / observation.durationMs >= 0.9, syncedAt: now() };
                writeLedger(storage, accountId, ledger);
                onStatus({ state: 'synced', lastSyncedAt: new Date(now()).toISOString(), message: '' });
            }
            if (waitingForMetadata) {
                onStatus({ state: 'waiting', message: 'Waiting for episode metadata. Connect a metadata addon or open the title and download it again.' });
            }
        } catch {
            if (!stopped) {
                onStatus({ state: 'retrying', message: 'Playback sync is unavailable. It will retry automatically while the app is open.' });
            }
        } finally {
            busy = false;
        }
    };
    return {
        run,
        start() {
            core.on?.('error', onCoreError);
            core.on?.('event', onCoreEvent);
            const initialRun = run();
            timer = setInterval(run, POLL_INTERVAL_MS);
            return initialRun;
        },
        stop() {
            stopped = true;
            clearInterval(timer);
            core.off?.('error', onCoreError);
            core.off?.('event', onCoreEvent);
        }
    };
};

module.exports = {
    SYNC_LEDGER_PREFIX,
    MIN_SYNC_INTERVAL_MS,
    getAccountId,
    isSyncEnabled,
    getEligibleProgress,
    getMetadataUrl,
    createMetadataResolver,
    createExternalPlaybackSync,
    subscribeStatus,
    getStatus,
    resetStatus
};

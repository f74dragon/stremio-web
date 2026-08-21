const React = require('react');
const {
    buildLegacyStremioMetaItemSnapshot,
    validateStremioMetaItemSnapshot
} = require('./stremioMetaItemSnapshot');

const WATCHED_PROGRESS_THRESHOLD = 0.9;
const WATCHED_SYNC_LEDGER_KEY = 'customStremio.mpcHcWatchedSync.v1';

const readLedger = (storage) => {
    try {
        const value = JSON.parse(storage?.getItem(WATCHED_SYNC_LEDGER_KEY) || '{}');
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
        return {};
    }
};

const writeLedger = (storage, ledger) => {
    try {
        storage?.setItem(WATCHED_SYNC_LEDGER_KEY, JSON.stringify(ledger));
    } catch {
        // A session-level guard still prevents repeated dispatches when storage is unavailable.
    }
};

const getEligibleMovieSyncs = ({ downloads, progressRecords, ledger = {} }) => {
    const downloadsById = new Map((downloads || []).map((record) => [record?.id, record]));
    return (progressRecords || []).flatMap((progressRecord) => {
        const download = downloadsById.get(progressRecord?.downloadId);
        const contentKey = typeof progressRecord?.contentKey === 'string' ? progressRecord.contentKey : null;
        const progress = Number(progressRecord?.progress);
        const durationMs = Number(progressRecord?.durationMs);
        const metaItem = validateStremioMetaItemSnapshot(download?.stremioMetaItem, {
            metaId: download?.metaId,
            type: download?.type
        }) || buildLegacyStremioMetaItemSnapshot(download);
        const eligible = download?.status === 'completed' &&
            download?.type === 'movie' &&
            progressRecord?.mediaType === 'movie' &&
            contentKey &&
            Number.isFinite(progress) && progress >= WATCHED_PROGRESS_THRESHOLD &&
            Number.isFinite(durationMs) && durationMs > 0 &&
            metaItem &&
            !ledger[contentKey];
        return eligible ? [{ contentKey, download, progressRecord, metaItem }] : [];
    });
};

const syncEligibleMovies = async ({ core, downloads, progressRecords, storage, sessionKeys = new Set() }) => {
    if (!core?.transport || typeof core.transport.dispatch !== 'function') {
        return { synced: [], failed: [] };
    }
    const ledger = readLedger(storage);
    const candidates = getEligibleMovieSyncs({ downloads, progressRecords, ledger })
        .filter(({ contentKey }) => !sessionKeys.has(contentKey));
    const synced = [];
    const failed = [];

    for (const { contentKey, metaItem } of candidates) {
        sessionKeys.add(contentKey);
        try {
            await core.transport.dispatch({
                action: 'Ctx',
                args: { action: 'AddToLibrary', args: metaItem }
            });
            await core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'MetaItemMarkAsWatched',
                    args: { meta_item: metaItem, is_watched: true }
                }
            });
            ledger[contentKey] = { syncedAt: new Date().toISOString() };
            synced.push(contentKey);
        } catch (error) {
            sessionKeys.delete(contentKey);
            failed.push({ contentKey, error });
        }
    }

    if (synced.length > 0) {
        writeLedger(storage, ledger);
    }
    return { synced, failed };
};

const useMpcHcWatchedSync = ({ core, downloads, progressRecords, enabled }) => {
    const sessionKeysRef = React.useRef(new Set());
    React.useEffect(() => {
        if (!enabled) {
            return;
        }
        syncEligibleMovies({
            core,
            downloads,
            progressRecords,
            storage: typeof window !== 'undefined' ? window.localStorage : null,
            sessionKeys: sessionKeysRef.current
        }).catch(() => undefined);
    }, [core, downloads, enabled, progressRecords]);
};

module.exports = {
    WATCHED_PROGRESS_THRESHOLD,
    WATCHED_SYNC_LEDGER_KEY,
    readLedger,
    getEligibleMovieSyncs,
    syncEligibleMovies,
    useMpcHcWatchedSync
};

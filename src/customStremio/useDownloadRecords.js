const React = require('react');
const {
    listDownloads,
    moveDownloadInQueue,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    retryDownload,
    deleteDownload,
    playDownload,
    openDownloadLocation
} = require('./localBackendClient');
const { ACTIVE_DOWNLOAD_STATUSES, POLLING_DOWNLOAD_STATUSES } = require('./downloadRecordPresentation');

const DEFAULT_POLL_INTERVAL = 1500;

const useDownloadRecords = ({ metaId, enabled = true, pollInterval = DEFAULT_POLL_INTERVAL } = {}) => {
    const loadedRef = React.useRef(false);
    const recordsRef = React.useRef([]);
    const snapshotRef = React.useRef('');
    const actionsRef = React.useRef({});
    const queryKey = enabled ? `enabled:${metaId ?? '*'}` : 'disabled';
    const queryKeyRef = React.useRef(queryKey);
    queryKeyRef.current = queryKey;

    const [items, setItems] = React.useState([]);
    const [initialLoading, setInitialLoading] = React.useState(false);
    const [refreshing, setRefreshing] = React.useState(false);
    const [error, setError] = React.useState('');
    const [actionStates, setActionStates] = React.useState({});
    const [actionErrors, setActionErrors] = React.useState({});

    const replaceItems = React.useCallback((nextItems) => {
        const normalizedItems = Array.isArray(nextItems) ? nextItems : [];
        const nextSnapshot = JSON.stringify(normalizedItems);
        recordsRef.current = normalizedItems;

        if (snapshotRef.current !== nextSnapshot) {
            snapshotRef.current = nextSnapshot;
            setItems(normalizedItems);
        }

        return normalizedItems;
    }, []);

    const reset = React.useCallback(() => {
        loadedRef.current = false;
        recordsRef.current = [];
        snapshotRef.current = '';
        actionsRef.current = {};
        setItems([]);
        setInitialLoading(false);
        setRefreshing(false);
        setError('');
        setActionStates({});
        setActionErrors({});
    }, []);

    const load = React.useCallback(async ({ silent = false } = {}) => {
        if (!enabled) {
            return [];
        }

        const requestedQueryKey = queryKey;
        const alreadyLoaded = loadedRef.current;
        if (!silent && !alreadyLoaded) {
            setInitialLoading(true);
        } else {
            setRefreshing(true);
        }

        if (!silent || !alreadyLoaded) {
            setError('');
        }

        try {
            const response = await listDownloads(metaId);
            if (queryKeyRef.current !== requestedQueryKey) {
                return recordsRef.current;
            }

            const nextItems = replaceItems(response?.items);
            loadedRef.current = true;
            setError('');
            return nextItems;
        } catch (requestError) {
            if (queryKeyRef.current !== requestedQueryKey) {
                return recordsRef.current;
            }

            const message = requestError?.message || 'Local backend is unavailable.';
            if (!loadedRef.current) {
                replaceItems([]);
            }
            setError(message);
            return recordsRef.current;
        } finally {
            if (queryKeyRef.current === requestedQueryKey) {
                setInitialLoading(false);
                setRefreshing(false);
            }
        }
    }, [enabled, metaId, queryKey, replaceItems]);

    const clearActionError = React.useCallback((recordId) => {
        setActionErrors((currentErrors) => {
            if (!Object.prototype.hasOwnProperty.call(currentErrors, recordId)) {
                return currentErrors;
            }

            const nextErrors = { ...currentErrors };
            delete nextErrors[recordId];
            return nextErrors;
        });
    }, []);

    const setAction = React.useCallback((recordId, action) => {
        const nextActions = { ...actionsRef.current };
        if (action === null) {
            delete nextActions[recordId];
        } else {
            nextActions[recordId] = action;
        }

        actionsRef.current = nextActions;
        setActionStates(nextActions);
    }, []);

    const updateItems = React.useCallback((updater) => {
        return replaceItems(updater(recordsRef.current));
    }, [replaceItems]);

    const pause = React.useCallback(async (recordId) => {
        if (!recordId || actionsRef.current[recordId]) {
            return;
        }

        clearActionError(recordId);
        setAction(recordId, 'pause');
        try {
            const pausedRecord = await pauseDownload(recordId);
            updateItems((currentItems) => currentItems.map((record) => record?.id === recordId ?
                { ...record, ...pausedRecord }
                :
                record
            ));
            await load({ silent: true });
        } catch (requestError) {
            setActionErrors((currentErrors) => ({
                ...currentErrors,
                [recordId]: requestError?.backendError || 'Could not pause this download. Check that the local backend is running.'
            }));
        } finally {
            setAction(recordId, null);
        }
    }, [clearActionError, load, setAction, updateItems]);

    const moveInQueue = React.useCallback(async (recordId, position) => {
        if (!recordId || actionsRef.current[recordId]) {
            return;
        }

        clearActionError(recordId);
        setAction(recordId, 'queue');
        try {
            await moveDownloadInQueue(recordId, position);
            await load({ silent: true });
        } catch (requestError) {
            setActionErrors((currentErrors) => ({
                ...currentErrors,
                [recordId]: requestError?.backendError || 'Could not reorder this download. Check that the local backend is running.'
            }));
        } finally {
            setAction(recordId, null);
        }
    }, [clearActionError, load, setAction]);

    const resume = React.useCallback(async (recordId) => {
        if (!recordId || actionsRef.current[recordId]) {
            return;
        }

        clearActionError(recordId);
        setAction(recordId, 'resume');
        try {
            const resumedRecord = await resumeDownload(recordId);
            updateItems((currentItems) => currentItems.map((record) => record?.id === recordId ?
                { ...record, ...resumedRecord }
                :
                record
            ));
            await load({ silent: true });
        } catch (requestError) {
            setActionErrors((currentErrors) => ({
                ...currentErrors,
                [recordId]: requestError?.backendError || 'Could not resume this download. Retry it from the beginning if the source no longer supports byte ranges.'
            }));
        } finally {
            setAction(recordId, null);
        }
    }, [clearActionError, load, setAction, updateItems]);

    const cancel = React.useCallback(async (recordId) => {
        if (!recordId || actionsRef.current[recordId]) {
            return;
        }

        clearActionError(recordId);
        setAction(recordId, 'cancel');
        try {
            const canceledRecord = await cancelDownload(recordId);
            updateItems((currentItems) => currentItems.map((record) => record?.id === recordId ?
                { ...record, ...canceledRecord }
                :
                record
            ));
            await load({ silent: true });
        } catch (requestError) {
            setActionErrors((currentErrors) => ({
                ...currentErrors,
                [recordId]: requestError?.backendError || 'Could not cancel this download. Check that the local backend is running.'
            }));
        } finally {
            setAction(recordId, null);
        }
    }, [clearActionError, load, setAction, updateItems]);

    const remove = React.useCallback(async (recordId) => {
        if (!recordId || actionsRef.current[recordId]) {
            return;
        }

        clearActionError(recordId);
        setAction(recordId, 'remove');
        try {
            await deleteDownload(recordId);
            updateItems((currentItems) => currentItems.filter((record) => record?.id !== recordId));
            await load({ silent: true });
        } catch (requestError) {
            setActionErrors((currentErrors) => ({
                ...currentErrors,
                [recordId]: requestError?.backendError || 'Could not remove this record. Check that the local backend is running.'
            }));
        } finally {
            setAction(recordId, null);
        }
    }, [clearActionError, load, setAction, updateItems]);

    const retry = React.useCallback(async (recordId) => {
        if (!recordId || actionsRef.current[recordId]) {
            return;
        }

        clearActionError(recordId);
        setAction(recordId, 'retry');
        try {
            const retriedRecord = await retryDownload(recordId);
            updateItems((currentItems) => currentItems.map((record) => record?.id === recordId ?
                { ...record, ...retriedRecord }
                :
                record
            ));
            await load({ silent: true });
        } catch (requestError) {
            setActionErrors((currentErrors) => ({
                ...currentErrors,
                [recordId]: requestError?.backendError || 'Could not retry this download. Check that the local backend is running.'
            }));
        } finally {
            setAction(recordId, null);
        }
    }, [clearActionError, load, setAction, updateItems]);

    const play = React.useCallback(async (recordId) => {
        if (!recordId || actionsRef.current[recordId]) {
            return;
        }

        clearActionError(recordId);
        setAction(recordId, 'play');
        try {
            await playDownload(recordId);
        } catch (requestError) {
            setActionErrors((currentErrors) => ({
                ...currentErrors,
                [recordId]: requestError?.backendError || 'Could not open this download. Check the local backend player configuration.'
            }));
        } finally {
            setAction(recordId, null);
        }
    }, [clearActionError, setAction]);

    const openLocation = React.useCallback(async (recordId) => {
        if (!recordId || actionsRef.current[recordId]) {
            return;
        }

        clearActionError(recordId);
        setAction(recordId, 'location');
        try {
            await openDownloadLocation(recordId);
        } catch (requestError) {
            setActionErrors((currentErrors) => ({
                ...currentErrors,
                [recordId]: requestError?.backendError || 'Could not open this download location. Check that the local backend is running.'
            }));
        } finally {
            setAction(recordId, null);
        }
    }, [clearActionError, setAction]);

    const hasActiveRecords = React.useMemo(() => {
        return items.some((record) => ACTIVE_DOWNLOAD_STATUSES.has(record?.status));
    }, [items]);
    const hasPollingRecords = React.useMemo(() => {
        return items.some((record) => POLLING_DOWNLOAD_STATUSES.has(record?.status));
    }, [items]);
    const onDownloadCreated = React.useCallback(() => load({ silent: true }), [load]);

    React.useEffect(() => {
        reset();
        if (enabled) {
            load();
        }
    }, [enabled, load, queryKey, reset]);

    React.useEffect(() => {
        if (!enabled || !hasPollingRecords || error) {
            return undefined;
        }

        const intervalId = window.setInterval(() => {
            load({ silent: true });
        }, pollInterval);

        return () => window.clearInterval(intervalId);
    }, [enabled, error, hasPollingRecords, load, pollInterval]);

    return {
        items,
        initialLoading,
        refreshing,
        error,
        actionStates,
        actionErrors,
        hasActiveRecords,
        hasPollingRecords,
        refresh: load,
        onDownloadCreated,
        moveInQueue,
        pause,
        resume,
        cancel,
        retry,
        play,
        openLocation,
        remove
    };
};

module.exports = useDownloadRecords;

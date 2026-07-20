const React = require('react');
const { listDownloadHistory } = require('./localBackendClient');

const DEFAULT_HISTORY_POLL_INTERVAL = 5000;
const HISTORY_READ_LIMIT = 1000;

const useDownloadHistory = ({ enabled = true, pollInterval = DEFAULT_HISTORY_POLL_INTERVAL } = {}) => {
    const loadedRef = React.useRef(false);
    const enabledRef = React.useRef(enabled);
    const snapshotRef = React.useRef('');
    const eventsRef = React.useRef([]);
    const [events, setEvents] = React.useState([]);
    const [total, setTotal] = React.useState(0);
    const [invalidEntryCount, setInvalidEntryCount] = React.useState(0);
    const [initialLoading, setInitialLoading] = React.useState(false);
    const [refreshing, setRefreshing] = React.useState(false);
    const [error, setError] = React.useState('');
    enabledRef.current = enabled;

    const load = React.useCallback(async ({ silent = false } = {}) => {
        if (!enabled) {
            return eventsRef.current;
        }
        if (!silent && !loadedRef.current) {
            setInitialLoading(true);
        } else {
            setRefreshing(true);
        }

        try {
            const response = await listDownloadHistory(HISTORY_READ_LIMIT);
            if (!enabledRef.current) {
                return eventsRef.current;
            }
            const nextEvents = Array.isArray(response?.items) ? response.items : [];
            const nextTotal = Number.isSafeInteger(response?.total) ? response.total : nextEvents.length;
            const nextInvalidEntryCount = Number.isSafeInteger(response?.invalidEntryCount) ? response.invalidEntryCount : 0;
            const nextSnapshot = JSON.stringify([nextEvents, nextTotal, nextInvalidEntryCount]);
            eventsRef.current = nextEvents;
            if (snapshotRef.current !== nextSnapshot) {
                snapshotRef.current = nextSnapshot;
                setEvents(nextEvents);
                setTotal(nextTotal);
                setInvalidEntryCount(nextInvalidEntryCount);
            }
            loadedRef.current = true;
            setError('');
            return nextEvents;
        } catch (requestError) {
            if (!enabledRef.current) {
                return eventsRef.current;
            }
            setError(requestError?.message || 'Local backend is unavailable.');
            return eventsRef.current;
        } finally {
            if (enabledRef.current) {
                setInitialLoading(false);
                setRefreshing(false);
            }
        }
    }, [enabled]);

    React.useEffect(() => {
        if (!enabled) {
            return undefined;
        }
        load();
        const timer = setInterval(() => load({ silent: true }), pollInterval);
        return () => clearInterval(timer);
    }, [enabled, load, pollInterval]);

    return {
        events,
        total,
        invalidEntryCount,
        initialLoading,
        refreshing,
        error,
        refresh: load
    };
};

module.exports = useDownloadHistory;

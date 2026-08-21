const React = require('react');
const { listDownloadHistory } = require('./localBackendClient');

const DEFAULT_HISTORY_POLL_INTERVAL = 5000;
const HISTORY_READ_LIMIT = 1000;

const toRangeBoundary = (value, endOfDay = false) => {
    if (typeof value !== 'string' || !value) {
        return undefined;
    }
    const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}`);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
};

const useDownloadHistory = ({ enabled = true, pollInterval = DEFAULT_HISTORY_POLL_INTERVAL, from = '', to = '' } = {}) => {
    const loadedRef = React.useRef(false);
    const enabledRef = React.useRef(enabled);
    const snapshotRef = React.useRef('');
    const eventsRef = React.useRef([]);
    const rangeRef = React.useRef({ from, to });
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
            const range = {
                from: toRangeBoundary(from),
                to: toRangeBoundary(to, true)
            };
            let response = await listDownloadHistory({ limit: HISTORY_READ_LIMIT, ...range });
            if (!enabledRef.current) {
                return eventsRef.current;
            }
            const nextEvents = Array.isArray(response?.items) ? [...response.items] : [];
            if (!silent) {
                while (response?.hasMore && response?.nextCursor) {
                    response = await listDownloadHistory({
                        limit: HISTORY_READ_LIMIT,
                        cursor: response.nextCursor,
                        ...range
                    });
                    if (!enabledRef.current) {
                        return eventsRef.current;
                    }
                    nextEvents.push(...(Array.isArray(response?.items) ? response.items : []));
                }
            }
            const uniqueEvents = Array.from(new Map(nextEvents.map((event) => [event.eventId, event])).values());
            const mergedEvents = silent && eventsRef.current.length > HISTORY_READ_LIMIT ?
                Array.from(new Map([...uniqueEvents, ...eventsRef.current].map((event) => [event.eventId, event])).values())
                : uniqueEvents;
            const nextTotal = Number.isSafeInteger(response?.filteredTotal) ? response.filteredTotal :
                Number.isSafeInteger(response?.total) ? response.total : mergedEvents.length;
            const nextInvalidEntryCount = Number.isSafeInteger(response?.invalidEntryCount) ? response.invalidEntryCount : 0;
            const nextSnapshot = JSON.stringify([mergedEvents, nextTotal, nextInvalidEntryCount]);
            eventsRef.current = mergedEvents;
            if (snapshotRef.current !== nextSnapshot) {
                snapshotRef.current = nextSnapshot;
                setEvents(mergedEvents);
                setTotal(nextTotal);
                setInvalidEntryCount(nextInvalidEntryCount);
            }
            loadedRef.current = true;
            setError('');
            return mergedEvents;
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
    }, [enabled, from, to]);

    React.useEffect(() => {
        if (!enabled) {
            return undefined;
        }
        if (rangeRef.current.from !== from || rangeRef.current.to !== to) {
            rangeRef.current = { from, to };
            loadedRef.current = false;
            eventsRef.current = [];
            snapshotRef.current = '';
            setEvents([]);
        }
        load();
        const timer = setInterval(() => load({ silent: true }), pollInterval);
        return () => clearInterval(timer);
    }, [enabled, from, load, pollInterval, to]);

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

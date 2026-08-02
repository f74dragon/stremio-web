const React = require('react');
const { listPlaybackProgress } = require('./localBackendClient');

const DEFAULT_POLL_INTERVAL = 3000;

const usePlaybackProgress = ({ enabled = true, pollInterval = DEFAULT_POLL_INTERVAL } = {}) => {
    const recordsRef = React.useRef([]);
    const snapshotRef = React.useRef('');
    const [records, setRecords] = React.useState([]);

    const load = React.useCallback(async () => {
        if (!enabled) {
            return recordsRef.current;
        }

        try {
            const response = await listPlaybackProgress();
            const nextRecords = Array.isArray(response?.records) ? response.records : [];
            const nextSnapshot = JSON.stringify(nextRecords);
            recordsRef.current = nextRecords;
            if (snapshotRef.current !== nextSnapshot) {
                snapshotRef.current = nextSnapshot;
                setRecords(nextRecords);
            }
            return nextRecords;
        } catch (_) {
            return recordsRef.current;
        }
    }, [enabled]);

    React.useEffect(() => {
        recordsRef.current = [];
        snapshotRef.current = '';
        setRecords([]);
        if (enabled) {
            load();
        }
    }, [enabled, load]);

    React.useEffect(() => {
        if (!enabled) {
            return undefined;
        }

        const intervalId = window.setInterval(load, pollInterval);
        return () => window.clearInterval(intervalId);
    }, [enabled, load, pollInterval]);

    const progressByDownloadId = React.useMemo(() => records.reduce((byDownloadId, progress) => {
        if (typeof progress?.downloadId === 'string' && progress.downloadId.length > 0) {
            byDownloadId[progress.downloadId] = progress;
        }
        return byDownloadId;
    }, {}), [records]);

    return { records, progressByDownloadId, refresh: load };
};

module.exports = usePlaybackProgress;

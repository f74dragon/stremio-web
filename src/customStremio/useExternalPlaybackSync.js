const React = require('react');
const backend = require('./localBackendClient');
const { createExternalPlaybackSync, resetStatus } = require('./externalPlaybackSync');

const useExternalPlaybackSync = ({ core, accountId }) => {
    React.useEffect(() => {
        resetStatus();
        if (!accountId) {
            return undefined;
        }
        let storage;
        try {
            storage = window.localStorage;
        } catch {
            // Session deduplication still works when browser storage is restricted.
        }
        const service = createExternalPlaybackSync({ core, accountId, backend, storage });
        service.start();
        return () => service.stop();
    }, [core, accountId]);
};

module.exports = useExternalPlaybackSync;

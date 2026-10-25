const React = require('react');

const initialState = { checking: false, canceling: false, canceled: false };

const useCancelableAvailabilityCheck = (contextKey) => {
    const activeCheck = React.useRef(null);
    const [state, setState] = React.useState(initialState);

    React.useEffect(() => {
        setState(initialState);
        return () => {
            activeCheck.current?.abort();
            activeCheck.current = null;
        };
    }, [contextKey]);

    const run = React.useCallback(async (check) => {
        if (activeCheck.current) {
            return;
        }
        const controller = new AbortController();
        activeCheck.current = controller;
        setState({ checking: true, canceling: false, canceled: false });
        // Ignore late UI updates after navigating to another title or episode.
        const commit = (update) => {
            if (activeCheck.current === controller) {
                update();
            }
        };
        try {
            return await check(controller.signal, commit);
        } finally {
            commit(() => {
                activeCheck.current = null;
                setState({ checking: false, canceling: false, canceled: controller.signal.aborted });
            });
        }
    }, []);

    const cancel = React.useCallback(() => {
        if (activeCheck.current && !activeCheck.current.signal.aborted) {
            activeCheck.current.abort();
            setState({ checking: true, canceling: true, canceled: false });
        }
    }, []);

    return { ...state, run, cancel };
};

module.exports = useCancelableAvailabilityCheck;

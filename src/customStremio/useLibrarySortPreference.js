const React = require('react');

const useLibrarySortPreference = (storageKey, fallback, allowedValues) => {
    const allowed = React.useMemo(() => new Set(allowedValues), [allowedValues]);
    const [value, setValue] = React.useState(() => {
        if (typeof window === 'undefined') {
            return fallback;
        }
        try {
            const stored = window.localStorage.getItem(storageKey);
            return allowed.has(stored) ? stored : fallback;
        } catch {
            return fallback;
        }
    });

    React.useEffect(() => {
        if (typeof window === 'undefined' || !allowed.has(value)) {
            return;
        }
        try {
            window.localStorage.setItem(storageKey, value);
        } catch {
            // Preferences are optional when storage is unavailable.
        }
    }, [allowed, storageKey, value]);

    return [value, setValue];
};

module.exports = useLibrarySortPreference;

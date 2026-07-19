const ALL_ADDONS_KEY = 'ALL';
const STREAM_ADDON_FILTER_STORAGE_KEY = 'customStremio.streamAddonFilter';

const readStreamAddonFilter = (storage) => {
    try {
        return storage?.getItem(STREAM_ADDON_FILTER_STORAGE_KEY) || ALL_ADDONS_KEY;
    } catch {
        return ALL_ADDONS_KEY;
    }
};

const persistStreamAddonFilter = (storage, value) => {
    try {
        if (!storage) {
            return;
        }
        if (value === ALL_ADDONS_KEY) {
            storage.removeItem(STREAM_ADDON_FILTER_STORAGE_KEY);
        } else {
            storage.setItem(STREAM_ADDON_FILTER_STORAGE_KEY, value);
        }
    } catch {
        // The current React state remains usable when browser storage is unavailable.
    }
};

const resolveStreamAddonFilter = (selectedAddon, streamsByAddon) => (
    selectedAddon === ALL_ADDONS_KEY || Object.prototype.hasOwnProperty.call(streamsByAddon, selectedAddon) ?
        selectedAddon
        : ALL_ADDONS_KEY
);

module.exports = {
    ALL_ADDONS_KEY,
    STREAM_ADDON_FILTER_STORAGE_KEY,
    readStreamAddonFilter,
    persistStreamAddonFilter,
    resolveStreamAddonFilter
};

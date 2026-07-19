/* global describe, test, expect */

const {
    ALL_ADDONS_KEY,
    STREAM_ADDON_FILTER_STORAGE_KEY,
    readStreamAddonFilter,
    persistStreamAddonFilter,
    resolveStreamAddonFilter
} = require('../src/customStremio/streamAddonFilter');

describe('stream addon filter persistence', () => {
    test('reads and writes a specific addon independently of the default', () => {
        const values = new Map();
        const storage = {
            getItem: (key) => values.get(key) || null,
            setItem: (key, value) => values.set(key, value),
            removeItem: (key) => values.delete(key)
        };

        expect(readStreamAddonFilter(storage)).toBe(ALL_ADDONS_KEY);
        persistStreamAddonFilter(storage, 'https://addon.example/manifest.json');
        expect(values.get(STREAM_ADDON_FILTER_STORAGE_KEY)).toBe('https://addon.example/manifest.json');
        expect(readStreamAddonFilter(storage)).toBe('https://addon.example/manifest.json');

        persistStreamAddonFilter(storage, ALL_ADDONS_KEY);
        expect(values.has(STREAM_ADDON_FILTER_STORAGE_KEY)).toBe(false);
    });

    test('temporarily falls back to all addons when the remembered addon is absent', () => {
        const selectedAddon = 'https://preferred.example/manifest.json';
        expect(resolveStreamAddonFilter(selectedAddon, {
            [selectedAddon]: { streams: [] }
        })).toBe(selectedAddon);
        expect(resolveStreamAddonFilter(selectedAddon, {
            'https://other.example/manifest.json': { streams: [] }
        })).toBe(ALL_ADDONS_KEY);
    });

    test('fails safely when browser storage is unavailable', () => {
        const blockedStorage = {
            getItem: () => { throw new Error('blocked'); },
            setItem: () => { throw new Error('blocked'); },
            removeItem: () => { throw new Error('blocked'); }
        };

        expect(readStreamAddonFilter(blockedStorage)).toBe(ALL_ADDONS_KEY);
        expect(() => persistStreamAddonFilter(blockedStorage, 'addon')).not.toThrow();
    });
});

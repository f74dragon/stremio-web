/* global describe, test, expect */

const {
    MAX_META_ITEM_SNAPSHOT_BYTES,
    buildStremioMetaItemSnapshot,
    buildLegacyStremioMetaItemSnapshot,
    validateStremioMetaItemSnapshot
} = require('../src/customStremio/stremioMetaItemSnapshot');

describe('Stremio metadata snapshots', () => {
    test('keeps the native preview fields needed by Stremio and excludes route state', () => {
        const snapshot = buildStremioMetaItemSnapshot({
            id: 'tt123',
            type: 'movie',
            name: 'Example Movie',
            released: new Date('2026-01-01T00:00:00.000Z'),
            poster: 'https://images.example/poster.jpg',
            links: [{ category: 'Genres', name: 'Drama', url: 'stremio:///discover/drama' }],
            behaviorHints: { defaultVideoId: 'tt123' },
            inLibrary: true,
            watched: false,
            deepLinks: { player: '#/player' },
            videos: [{ id: 'large-video-list' }]
        });

        expect(snapshot).toMatchObject({
            id: 'tt123',
            type: 'movie',
            name: 'Example Movie',
            released: '2026-01-01T00:00:00.000Z'
        });
        expect(snapshot).not.toHaveProperty('inLibrary');
        expect(snapshot).not.toHaveProperty('watched');
        expect(snapshot).not.toHaveProperty('deepLinks');
        expect(snapshot).not.toHaveProperty('videos');
    });

    test('rejects mismatched, incomplete, and oversized metadata', () => {
        const valid = { id: 'tt123', type: 'movie', name: 'Example Movie' };
        expect(validateStremioMetaItemSnapshot(valid, { metaId: 'tt123', type: 'movie' })).not.toBeNull();
        expect(validateStremioMetaItemSnapshot(valid, { metaId: 'tt999', type: 'movie' })).toBeNull();
        expect(buildStremioMetaItemSnapshot({ id: 'tt123', type: 'movie' })).toBeNull();
        expect(buildStremioMetaItemSnapshot({ ...valid, description: 'x'.repeat(MAX_META_ITEM_SNAPSHOT_BYTES) })).toBeNull();
    });

    test('builds a valid movie preview from a legacy download record', () => {
        expect(buildLegacyStremioMetaItemSnapshot({
            metaId: 'tt123',
            type: 'movie',
            parentTitle: 'Legacy Movie',
            poster: 'https://images.example/legacy.jpg',
            metaLinks: [{ category: 'Genres', name: 'Drama', url: 'stremio:///discover/drama' }]
        })).toMatchObject({
            id: 'tt123',
            type: 'movie',
            name: 'Legacy Movie',
            posterShape: 'poster',
            trailerStreams: [],
            behaviorHints: {}
        });
    });
});

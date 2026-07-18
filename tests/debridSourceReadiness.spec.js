/* global describe, test, expect */

const {
    SOURCE_READINESS,
    extractInfoHashFromValue,
    getStreamInfoHash,
    classifyDebridSourceReadiness,
    getSourceReadinessSortRank
} = require('../src/customStremio/debridSourceReadiness');

describe('debrid source readiness', () => {
    test('recognizes only Torrentio explicit positive cache labels', () => {
        expect(classifyDebridSourceReadiness({ name: 'Torrentio\n[AD+] 1080p' })).toBe(SOURCE_READINESS.CACHED);
        expect(classifyDebridSourceReadiness({ description: '4K HDR\n[AD Download]' })).toBe(SOURCE_READINESS.UNKNOWN);
    });

    test('extracts a single torrent hash from native streams and resolver URLs', () => {
        const hash = '842783e3005495d5d1637f5364b59343c7844707';
        expect(extractInfoHashFromValue(`https://torrentio.example/${hash}/movie.mkv`)).toBe(hash);
        expect(getStreamInfoHash({ deepLinks: { externalPlayer: { download: `https://torrentio.example/resolve/${hash}` } } })).toBe(hash);
        expect(extractInfoHashFromValue(`${hash}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`)).toBeNull();
    });

    test('uses stored provider observations ahead of addon text hints', () => {
        expect(classifyDebridSourceReadiness({ name: '[AD+]' }, { status: 'uncached' })).toBe(SOURCE_READINESS.REQUIRES_CACHING);
        expect(classifyDebridSourceReadiness({}, { status: 'cached', previouslyVerified: true })).toBe(SOURCE_READINESS.PREVIOUSLY_CACHED);
    });

    test('does not infer a negative cache result from route labels', () => {
        expect(classifyDebridSourceReadiness({ name: '[AD+]', description: '[AD Download]' })).toBe(SOURCE_READINESS.CACHED);
        expect(classifyDebridSourceReadiness({ name: 'MediaFusion', description: '1080p WEB-DL' })).toBe(SOURCE_READINESS.UNKNOWN);
        expect(classifyDebridSourceReadiness({ description: 'A bad+ encoding label' })).toBe(SOURCE_READINESS.UNKNOWN);
    });

    test('sorts cached sources first and download-to-debrid sources last', () => {
        expect([
            SOURCE_READINESS.REQUIRES_CACHING,
            SOURCE_READINESS.UNKNOWN,
            SOURCE_READINESS.PREVIOUSLY_CACHED,
            SOURCE_READINESS.CACHED
        ].sort((left, right) => getSourceReadinessSortRank(left) - getSourceReadinessSortRank(right))).toEqual([
            SOURCE_READINESS.CACHED,
            SOURCE_READINESS.PREVIOUSLY_CACHED,
            SOURCE_READINESS.UNKNOWN,
            SOURCE_READINESS.REQUIRES_CACHING
        ]);
    });
});

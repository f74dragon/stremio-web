/* global describe, test, expect */

const {
    DEBRID_PROVIDER,
    SOURCE_READINESS,
    extractInfoHashFromValue,
    getStreamInfoHash,
    getStreamProbeUrl,
    getRealDebridSourceDescriptor,
    getRealDebridAvailabilitySortRank,
    getDebridProvider,
    classifyDebridSourceReadiness,
    classifyProviderSourceReadiness,
    shouldProbeRealDebridAvailability,
    isSourceReadinessBlocked,
    getSourceReadinessSortRank
} = require('../src/customStremio/debridSourceReadiness');

describe('debrid source readiness', () => {
    test('does not promote addon cache claims into verified cache results', () => {
        expect(classifyDebridSourceReadiness({ name: 'Torrentio\n[AD+] 1080p' })).toBe(SOURCE_READINESS.UNKNOWN);
        expect(classifyDebridSourceReadiness({ description: '4K HDR\n[AD Download]' })).toBe(SOURCE_READINESS.UNKNOWN);
    });

    test('extracts a single torrent hash from native streams and resolver URLs', () => {
        const hash = '842783e3005495d5d1637f5364b59343c7844707';
        expect(extractInfoHashFromValue(`https://torrentio.example/${hash}/movie.mkv`)).toBe(hash);
        expect(getStreamInfoHash({ deepLinks: { externalPlayer: { download: `https://torrentio.example/resolve/${hash}` } } })).toBe(hash);
        expect(getStreamInfoHash({
            deepLinks: {
                externalPlayer: {
                    openPlayer: {
                        windows: `https://torrentio.strem.fun/realdebrid=secret/resolve/${hash}/1/episode.mkv`
                    }
                }
            }
        })).toBe(hash);
        expect(extractInfoHashFromValue(`${hash}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`)).toBeNull();
    });

    test('uses stored provider observations ahead of addon text hints', () => {
        expect(classifyDebridSourceReadiness({ name: '[AD+]' }, { status: 'uncached' })).toBe(SOURCE_READINESS.REQUIRES_CACHING);
        expect(classifyDebridSourceReadiness({}, { status: 'cached', previouslyVerified: true })).toBe(SOURCE_READINESS.PREVIOUSLY_CACHED);
    });

    test('identifies provider-specific addon and stream markers conservatively', () => {
        expect(getDebridProvider({ addonName: 'Torrentio AD' })).toBe(DEBRID_PROVIDER.ALLDEBRID);
        expect(getDebridProvider({ addonName: 'Torrentio RD' })).toBe(DEBRID_PROVIDER.REALDEBRID);
        expect(getDebridProvider({ name: '[AD+] 1080p', addonName: 'Torrentio' })).toBe(DEBRID_PROVIDER.ALLDEBRID);
        expect(getDebridProvider({ description: '[RD Download] 4K', addonName: 'Torrentio' })).toBe(DEBRID_PROVIDER.REALDEBRID);
        expect(getDebridProvider({ title: '[RD+] Torrentio 1080p' })).toBe(DEBRID_PROVIDER.REALDEBRID);
        expect(getDebridProvider({
            deepLinks: { externalPlayer: { download: 'https://torrentio.strem.fun/realdebrid=secret/resolve/file' } }
        })).toBe(DEBRID_PROVIDER.REALDEBRID);
        expect(getDebridProvider({ addonName: 'MediaFusion' })).toBe(DEBRID_PROVIDER.UNKNOWN);
        expect(getDebridProvider({ addonName: 'Torrentio AD RD' })).toBe(DEBRID_PROVIDER.UNKNOWN);
    });

    test('applies only the matching provider observation to each source row', () => {
        expect(classifyProviderSourceReadiness({ addonName: 'Torrentio AD' }, {
            allDebridAvailability: { status: 'uncached' },
            realDebridAvailability: { status: 'cached' }
        })).toBe(SOURCE_READINESS.REQUIRES_CACHING);
        expect(classifyProviderSourceReadiness({ addonName: 'Torrentio RD' }, {
            allDebridAvailability: { status: 'uncached' },
            realDebridAvailability: { status: 'cached' }
        })).toBe(SOURCE_READINESS.CACHED);
        expect(classifyProviderSourceReadiness({ addonName: 'Torrentio RD' }, {
            realDebridAvailability: { status: 'unavailable' }
        })).toBe(SOURCE_READINESS.UNAVAILABLE);
        expect(classifyProviderSourceReadiness({ addonName: 'Torrentio RD' }, {
            realDebridAvailability: { status: 'ready' }
        })).toBe(SOURCE_READINESS.READY);
        expect(classifyProviderSourceReadiness({ name: '[RD+] Torrentio 1080p' })).toBe(SOURCE_READINESS.UNKNOWN);
        expect(isSourceReadinessBlocked(SOURCE_READINESS.REQUIRES_CACHING)).toBe(true);
        expect(isSourceReadinessBlocked(SOURCE_READINESS.UNAVAILABLE)).toBe(true);
        expect(isSourceReadinessBlocked(SOURCE_READINESS.CACHED)).toBe(false);
    });

    test('uses resolver fallback for every non-positive Real-Debrid result', () => {
        expect(shouldProbeRealDebridAvailability({ status: 'unknown', error: 'ambiguous_files' })).toBe(true);
        expect(shouldProbeRealDebridAvailability({ status: 'error', error: 'pre-existing torrent protected' })).toBe(true);
        expect(shouldProbeRealDebridAvailability({ status: 'uncached' })).toBe(true);
        expect(shouldProbeRealDebridAvailability({ status: 'unavailable' })).toBe(true);
        expect(shouldProbeRealDebridAvailability({ status: 'invalid', error: 'bad source' })).toBe(false);
        expect(shouldProbeRealDebridAvailability({ status: 'cached' })).toBe(false);
        expect(shouldProbeRealDebridAvailability({ status: 'ready' })).toBe(false);
    });

    test('builds exact Real-Debrid source descriptors for per-file history', () => {
        const hash = '842783e3005495d5d1637f5364b59343c7844707';
        expect(getRealDebridSourceDescriptor({
            infoHash: hash,
            fileIdx: 3,
            behaviorHints: { filename: 'Show.S01E04.mkv', videoSize: 1234 }
        })).toEqual({
            hash,
            fileIdx: 3,
            filename: 'Show.S01E04.mkv',
            videoSize: 1234,
            probeUrl: null,
            key: `${hash}::3::show.s01e04.mkv::1234`
        });
        expect(getRealDebridSourceDescriptor({
            infoHash: hash,
            deepLinks: { externalPlayer: { download: 'https://resolver.example/download' } }
        })).toMatchObject({ probeUrl: 'https://resolver.example/download' });
        expect(getStreamProbeUrl({ url: 'magnet:?xt=urn:btih:test' })).toBeNull();
    });

    test('sorts exact Real-Debrid cached results before unknown and unavailable results', () => {
        expect([
            { status: 'unavailable' },
            null,
            { status: 'ready' },
            { status: 'cached', previouslyVerified: true },
            { status: 'uncached' },
            { status: 'cached' }
        ].sort((left, right) => getRealDebridAvailabilitySortRank(left) - getRealDebridAvailabilitySortRank(right)))
            .toEqual([
                { status: 'cached' },
                { status: 'ready' },
                { status: 'cached', previouslyVerified: true },
                null,
                { status: 'uncached' },
                { status: 'unavailable' }
            ]);
    });

    test('does not infer a negative cache result from route labels', () => {
        expect(classifyDebridSourceReadiness({ name: '[AD+]', description: '[AD Download]' })).toBe(SOURCE_READINESS.UNKNOWN);
        expect(classifyDebridSourceReadiness({ name: '[AD+]' }, { status: 'unavailable' })).toBe(SOURCE_READINESS.UNAVAILABLE);
        expect(classifyDebridSourceReadiness({ name: 'MediaFusion', description: '1080p WEB-DL' })).toBe(SOURCE_READINESS.UNKNOWN);
        expect(classifyDebridSourceReadiness({ description: 'A bad+ encoding label' })).toBe(SOURCE_READINESS.UNKNOWN);
    });

    test('sorts cached sources first and download-to-debrid sources last', () => {
        expect([
            SOURCE_READINESS.REQUIRES_CACHING,
            SOURCE_READINESS.UNAVAILABLE,
            SOURCE_READINESS.UNKNOWN,
            SOURCE_READINESS.READY,
            SOURCE_READINESS.PREVIOUSLY_CACHED,
            SOURCE_READINESS.CACHED
        ].sort((left, right) => getSourceReadinessSortRank(left) - getSourceReadinessSortRank(right))).toEqual([
            SOURCE_READINESS.CACHED,
            SOURCE_READINESS.READY,
            SOURCE_READINESS.PREVIOUSLY_CACHED,
            SOURCE_READINESS.UNKNOWN,
            SOURCE_READINESS.REQUIRES_CACHING,
            SOURCE_READINESS.UNAVAILABLE
        ]);
    });
});

const { filterAndSortSources } = require('../src/customStremio/sourceListPresentation');

const getReadiness = (stream) => stream.readiness || 'unknown';
const names = (sources, options = {}) => filterAndSortSources(sources, { getReadiness, ...options }).map((source) => source.name);

test('search matches all words across source names, filenames, addon names, and descriptions', () => {
    const sources = [
        { name: 'Torrentio 4K', addonName: 'Example Addon', description: 'HEVC • Français', behaviorHints: { filename: 'Show.S01E02.2160p.mkv' } },
        { name: 'Torrentio 1080p', addonName: 'Example Addon', description: 'H264 • English' }
    ];
    expect(names(sources, { search: '  EXAMPLE  2160p hevc francais ' })).toEqual(['Torrentio 4K']);
    expect(names(sources, { search: 'English HEVC' })).toEqual([]);
});

test('search treats punctuation as literal text and supports torrent hashes', () => {
    const sources = [{ name: '[RD+] 4K', infoHash: 'abcdef012345' }, { name: 'RD download' }];
    expect(names(sources, { search: '[RD+]' })).toEqual(['[RD+] 4K']);
    expect(names(sources, { search: 'ABCDEF' })).toEqual(['[RD+] 4K']);
});

test.each([
    ['available', ['cached', 'ready', 'previously_cached']],
    ['unchecked', ['unknown']],
    ['uncached', ['requires_caching']],
    ['unavailable', ['unavailable']]
])('availability filter %s matches only its supported observations', (availability, expected) => {
    const sources = ['unknown', 'cached', 'unavailable', 'ready', 'requires_caching', 'previously_cached']
        .map((readiness) => ({ name: readiness, readiness }));
    expect(names(sources, { availability })).toEqual(expected);
});

test('search and availability combine, without modifying the source pool used by batch selection', () => {
    const sources = Object.freeze([
        Object.freeze({ name: '4K cached', readiness: 'cached' }),
        Object.freeze({ name: '4K unchecked', readiness: 'unknown' }),
        Object.freeze({ name: '1080p cached', readiness: 'cached' })
    ]);
    expect(names(sources, { search: '4K', availability: 'available' })).toEqual(['4K cached']);
    expect(sources).toHaveLength(3);
    expect(names(sources)).toEqual(['4K cached', '1080p cached', '4K unchecked']);
});

test('recommended order preserves preferred addon priority and then readiness, with stable ties', () => {
    const sources = [
        { name: 'Other cached', addonName: 'Other', readiness: 'cached' },
        { name: 'Preferred unknown 1', addonName: 'PREFERRED' },
        { name: 'Preferred cached', addonName: 'Preferred', readiness: 'cached' },
        { name: 'Preferred unknown 2', addonName: 'Preferred' }
    ];
    expect(names(sources, { preferredAddon: ' preferred ' })).toEqual([
        'Preferred cached', 'Preferred unknown 1', 'Preferred unknown 2', 'Other cached'
    ]);
});

test('quality sorts by resolution including filename hints, overriding recommended priority', () => {
    const sources = [
        { name: '1080p', readiness: 'cached', addonName: 'Preferred' },
        { name: '720p' }, { name: '1440p' }, { name: 'UHD' },
        { name: 'File', behaviorHints: { filename: 'Show.4320p.mkv' } },
        { name: 'Unknown' }, { name: 'Other 4K' }
    ];
    expect(names(sources, { sort: 'quality', preferredAddon: 'Preferred' })).toEqual([
        'File', 'UHD', 'Other 4K', '1440p', '1080p', '720p', 'Unknown'
    ]);
});

test('file size sort uses numeric hints or addon text and keeps missing sizes last in either direction', () => {
    const sources = [
        { name: 'Unknown' }, { name: '1 GB', behaviorHints: { videoSize: 1024 ** 3 } },
        { name: '900 MB', description: '💾 900 MiB' }, { name: '10 GB', title: 'Size: 10 GiB' },
        { name: 'Invalid', behaviorHints: { videoSize: -1 } }
    ];
    expect(names(sources, { sort: 'size-desc' })).toEqual(['10 GB', '1 GB', '900 MB', 'Unknown', 'Invalid']);
    expect(names(sources, { sort: 'size-asc' })).toEqual(['900 MB', '1 GB', '10 GB', 'Unknown', 'Invalid']);
});

test('name sorting uses natural numeric order and leaves equal names stable', () => {
    expect(names([{ name: 'Source 10' }, { name: 'source 2' }, { name: 'Alpha' }], { sort: 'name' }))
        .toEqual(['Alpha', 'source 2', 'Source 10']);
});

test('empty lists, blank searches, and missing optional fields remain usable', () => {
    expect(filterAndSortSources([], { search: '4K' })).toEqual([]);
    expect(filterAndSortSources([{}], { search: '  ' })).toEqual([{}]);
    expect(filterAndSortSources([{}], { search: 'anything' })).toEqual([]);
});

/* global test, expect */
const { getSourceSizeLabel } = require('../src/customStremio/sourceSizePresentation');
test('shows an independent size from hints or long addon descriptions, with an honest unknown fallback', () => {
    expect(getSourceSizeLabel({ behaviorHints: { videoSize: 12.5 * 1024 ** 3 } })).toBe('12.5 GB');
    expect(getSourceSizeLabel({ description: `${'Very long filename '.repeat(100)}\n💾 2.4 GB` })).toBe('2.4 GB');
    expect(getSourceSizeLabel({ name: 'A 1080p source with no size' })).toBe('Size unknown');
});

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { transformSync } = require('@babel/core');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { groupDownloadRecordsByMedia } = require('../src/customStremio/downloadRecordPresentation');

// Render the actual JSX component with only its app-shell dependencies replaced.
const filename = path.resolve(__dirname, '../src/customStremio/components/DownloadMediaGroup.js');
const localRequire = createRequire(filename);
const componentModule = { exports: {} };
const t = (key, options = {}) => (options.defaultValue || key)
    .replace(/{{(\w+)}}/g, (_, name) => options[name] ?? '');
const componentRequire = (id) => {
    if (id === 'react-i18next') {
        return { useTranslation: () => ({ t }) };
    }
    if (id === 'stremio/components') {
        return { Image: (props) => React.createElement('img', props) };
    }
    if (id === '@stremio/stremio-icons/react') {
        return { default: () => React.createElement('svg') };
    }
    if (id.endsWith('.less')) {
        return new Proxy({}, { get: (_, name) => name });
    }
    return localRequire(id);
};
const { code } = transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, configFile: false, babelrc: false, presets: ['@babel/preset-react']
});
new Function('require', 'module', 'exports', code)(componentRequire, componentModule, componentModule.exports);
const DownloadMediaGroup = componentModule.exports;

const render = (records, progress = {}) => renderToStaticMarkup(React.createElement(DownloadMediaGroup, {
    group: groupDownloadRecordsByMedia(records)[0], actionStates: {}, actionErrors: {}, playbackProgressByDownloadId: progress
}));

test.each(['queued', 'downloading', 'paused', 'failed', 'canceled'])(
    'renders a %s series when no completed episode is available to resume', (status) => {
        expect(() => render([{ id: 'episode', type: 'series', metaId: 'show', parentTitle: 'Example Show',
            videoId: 'show:1:1', season: 1, episode: 1, status }])).not.toThrow();
    }
);

test('renders usable episode resume context for a completed download', () => {
    const html = render([{ id: 'episode', type: 'series', metaId: 'show', parentTitle: 'Example Show',
        videoId: 'show:1:2', season: 1, episode: 2, status: 'completed' }], {
        episode: { progress: 0.4, positionMs: 40000, durationMs: 100000 }
    });
    expect(html).toContain('Example Show');
    expect(html).toContain('1:00 left');
});

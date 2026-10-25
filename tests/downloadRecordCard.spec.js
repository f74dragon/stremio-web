const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { transformSync } = require('@babel/core');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const filename = path.resolve(__dirname, '../src/customStremio/components/DownloadRecordCard.js');
const localRequire = createRequire(filename);
const componentModule = { exports: {} };
const componentRequire = (id) => {
    if (id === 'react-i18next') {
        return { useTranslation: () => ({ t: (key, options = {}) => (options.defaultValue || key)
            .replace(/{{(\w+)}}/g, (_, name) => options[name] ?? '') }) };
    }
    if (id === 'stremio/components') {
        return { Button: ({ children, ...props }) => React.createElement('button', props, children) };
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
const DownloadRecordCard = componentModule.exports;

const render = (props = {}) => renderToStaticMarkup(React.createElement(DownloadRecordCard, {
    record: { id: 'file', type: 'movie', parentTitle: 'Example', videoTitle: 'Example', status: 'completed', progress: 100,
        localPath: 'C:\\Downloads\\Example.mkv', bytesTotal: 1000000 },
    onDeleteMedia: () => {}, ...props
}));

test.each(['compact', 'library'])('completed %s card keeps Play visible and maintenance in a closed menu', (variant) => {
    const html = render({ variant });
    expect(html).not.toContain('class="progress-track"');
    expect(html).not.toContain('100%');
    expect(html).toMatch(/class="play-button"[^>]*>Play<\/button>/);
    expect(html).toMatch(/<button type="button" class="more-actions" aria-haspopup="menu" aria-expanded="false" aria-label="More actions for Example"/);
    expect(html).not.toContain('role="menu"');
    expect(html).not.toContain('Delete download');
    expect(html).toMatch(/<details class="download-info"><summary>Download info<\/summary>[\s\S]*Example.mkv/);
    expect(html).not.toContain('<details open');
    expect(html).not.toContain('role="alertdialog"');
});

test.each([
    ['downloading', 'Pause'], ['queued', 'Pause'], ['paused', 'Resume'], ['failed', 'Retry']
])('%s card retains its transfer control and progress', (status, action) => {
    const html = render({ record: { id: 'file', parentTitle: 'Example', status, progress: 42 } });
    expect(html).toContain('class="progress-track"');
    expect(html).toContain('>42%</span>');
    expect(html).toContain('width:42%');
    expect(html).toContain(`>${action}</button>`);
    expect(html).not.toContain('class="play-button"');
});

test('selection mode suppresses playback and maintenance actions', () => {
    const html = render({ selectionMode: true });
    expect(html).not.toContain('class="more-actions"');
    expect(html).not.toContain('class="play-button"');
});

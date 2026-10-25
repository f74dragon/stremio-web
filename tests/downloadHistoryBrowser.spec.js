const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { transformSync } = require('@babel/core');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const filename = path.resolve(__dirname, '../src/customStremio/components/DownloadHistoryBrowser.js');
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
    if (id === '@stremio/stremio-icons/react') {
        return { default: () => React.createElement('svg') };
    }
    if (id === './DownloadLibraryToolbar') {
        return () => React.createElement('div', null, 'Search and sorting');
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
const History = componentModule.exports;
const noop = () => {};
const render = (fromValue) => renderToStaticMarkup(React.createElement(History, {
    groups: [], searchValue: '', fromValue, toValue: '', sortValue: 'latest', eventCount: 0, total: 0,
    invalidEntryCount: 0, initialLoading: false, refreshing: false, error: '', onRefresh: noop,
    onSearchChange: noop, onFromChange: noop, onToChange: noop, onSortChange: noop
}));

test('an empty date range keeps its controls and clear action available', () => {
    const html = render('2099-01-01');
    expect(html).toContain('History date range');
    expect(html).toContain('value="2099-01-01"');
    expect(html).toContain('Clear dates');
    expect(html).toContain('No titles match this history filter.');
    expect(html).not.toContain('No download history yet');
});

test('an archive with no records and no date filter shows the initial empty state', () => {
    const html = render('');
    expect(html).toContain('No download history yet');
    expect(html).not.toContain('Clear dates');
});

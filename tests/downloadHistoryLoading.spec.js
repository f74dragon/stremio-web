const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const useDownloadHistory = require('../src/customStremio/useDownloadHistory');

jest.mock('../src/customStremio/localBackendClient', () => ({ listDownloadHistory: jest.fn() }));

const InitialHistory = ({ enabled }) => {
    const { initialLoading } = useDownloadHistory({ enabled });
    return React.createElement('span', null, initialLoading ? 'Loading history' : 'Idle');
};

test('history opens in a loading state before its first request starts, avoiding a false empty message', () => {
    expect(renderToStaticMarkup(React.createElement(InitialHistory, { enabled: true }))).toContain('Loading history');
});

test('history does not show a loading state while another view is selected', () => {
    expect(renderToStaticMarkup(React.createElement(InitialHistory, { enabled: false }))).toContain('Idle');
});

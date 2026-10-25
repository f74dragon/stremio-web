const path = require('node:path');
const release = require('./release-config.json');
const desktop = require('./package.json');

module.exports = {
    appId: release.appId,
    productName: desktop.productName,
    executableName: release.executableName,
    electronVersion: require('electron/package.json').version,
    electronDist: path.dirname(require('electron')),
    directories: { app: '.core-build/desktop-app', output: 'dist/windows-launcher' },
    files: ['desktop/**/*', 'build/**/*', 'local-backend/**/*', 'src/customStremio/*.js', 'licenses/**/*', 'LICENSE.md', 'build-info.json', 'package.json'],
    asar: true,
    npmRebuild: false,
    win: { target: 'dir', signAndEditExecutable: false },
    publish: null
};

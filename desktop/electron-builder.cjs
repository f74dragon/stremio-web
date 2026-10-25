const path = require('node:path');
const release = require('./release-config.json');
const desktop = require('./package.json');

module.exports = {
    appId: release.appId,
    productName: desktop.productName,
    executableName: release.executableName,
    electronVersion: require('electron/package.json').version,
    electronDist: path.dirname(require('electron')),
    directories: { app: '.core-build/desktop-app', output: 'dist/windows-launcher', buildResources: 'desktop/assets' },
    files: ['desktop/**/*', 'build/**/*', 'local-backend/**/*', 'src/customStremio/*.js', 'licenses/**/*', 'LICENSE.md', 'build-info.json', 'package.json'],
    asar: true,
    npmRebuild: false,
    win: {
        target: 'nsis', icon: 'desktop/assets/icon.ico',
        signAndEditExecutable: true, signExecutable: false, requestedExecutionLevel: 'asInvoker'
    },
    nsis: {
        artifactName: 'Custom-Stremio-${version}-windows-${arch}-setup.${ext}',
        oneClick: true, perMachine: false, allowElevation: false,
        createDesktopShortcut: true, createStartMenuShortcut: true,
        shortcutName: desktop.productName, uninstallDisplayName: desktop.productName,
        deleteAppDataOnUninstall: false, runAfterFinish: false,
        include: 'desktop/installer.nsh', packElevateHelper: false
    },
    publish: null
};

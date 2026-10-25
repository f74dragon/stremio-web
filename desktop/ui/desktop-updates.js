const bridge = window.customStremioDesktop;
const element = (id) => document.getElementById(id);
const messages = {
    idle: ['Ready when you are', 'Choose the update file and keep its installer beside it.'],
    checking: ['Checking your bundle', 'Verifying the update’s signature and compatibility…'],
    copying: ['Preparing your update', 'Copying and verifying the installer. You can keep using the app.'],
    ready: ['Ready to restart', 'Your update is verified. Restart when you’re ready; downloads will pause and progress will be saved.'],
    installing: ['Saving and restarting', 'The app will close, back up its files, install your update, and reopen.'],
    complete: ['You’re up to date', 'Your personal app update finished successfully.'],
    error: ['Update not installed', 'Your current app and data have been kept. Choose a verified bundle to try again.']
};
const errors = {
    INVALID_SIGNATURE: 'This bundle wasn’t signed with your personal build key. Choose a bundle built for this app.',
    NOT_NEWER: 'This bundle is the same version or older. Choose a newer personal build.',
    WRONG_APPLICATION: 'This update is for a different app, channel, or Windows architecture.',
    UNSUPPORTED_DATA_SCHEMA: 'This build changes saved-data formats. Install it only after a separate migration review.',
    ARTIFACT_MISMATCH: 'The installer is missing, incomplete, or changed. Build a fresh bundle and choose it again.',
    INSTALLED_APP_REQUIRED: 'Install this build with its Windows setup first. Updates apply to installed copies.',
    INVALID_CACHE: 'The prepared update could not be verified. Choose the original bundle again.',
    UPDATE_INTERRUPTED: 'The previous update did not finish. Your saved data remains; choose a bundle again.',
    INSTALLER_FAILED: 'Setup failed. The previous app files were restored and your saved data was kept.',
    INSTALLED_FILES_MISMATCH: 'Setup did not produce the expected app. The previous files were restored.',
    RESTORE_FAILED: 'Setup and automatic restore failed. Reinstall your previous setup; saved data and backups remain on this PC.',
    INSTALLER_STILL_RUNNING: 'Setup is taking longer than expected. Let it finish before reopening or reinstalling the app.',
    APP_STILL_RUNNING: 'Another app instance is still running. Quit it before trying the update again.',
    UPDATE_IN_PROGRESS: 'An update is already running. Let it finish before starting another.',
    UPDATE_NOT_STARTED: 'The app could not shut down cleanly or start setup. It has reopened safely; try again when ready.'
};
const render = (state) => {
    const message = messages[state.phase] || messages.error;
    const busy = ['checking', 'copying', 'installing'].includes(state.phase);
    element('status-title').textContent = message[0];
    element('message').textContent = errors[state.code] || message[1];
    element('version').textContent = `Installed ${state.currentVersion}${state.version ? ` · Update ${state.version}` : ''}`;
    element('badge').textContent = state.phase === 'ready' ? 'Verified' : 'Personal';
    element('progress').hidden = state.phase !== 'copying';
    element('progress').value = state.percent || 0;
    element('choose').hidden = busy;
    element('choose').classList.toggle('primary', state.phase !== 'ready');
    element('choose').textContent = state.phase === 'ready' ? 'Choose another' : 'Choose update bundle';
    element('choose').disabled = busy;
    element('install').hidden = state.phase !== 'ready';
    element('install').disabled = !state.installable;
    element('cancel').hidden = !['checking', 'copying'].includes(state.phase);
    element('close').disabled = state.phase === 'installing';
    element('code').textContent = state.phase === 'ready' && !state.installable ? 'Run the Windows installer once to enable app updates.' : '';
};
const action = (name) => bridge[name]().then((state) => { if (state) render(state); }).catch(() => { /* Closing/restarting disposes this page. */ });
element('choose').addEventListener('click', () => action('chooseUpdate'));
element('cancel').addEventListener('click', () => action('cancelUpdate'));
element('install').addEventListener('click', () => action('installUpdate'));
element('close').addEventListener('click', () => action('closeUpdates'));
bridge.onUpdateStatus(render);
action('getUpdateStatus');

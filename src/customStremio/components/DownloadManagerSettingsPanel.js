const React = require('react');
const PropTypes = require('prop-types');
const { useTranslation } = require('react-i18next');
const { Button } = require('stremio/components');
const {
    getBackendSettings,
    updateBackendSettings,
    startAllDebridPinAuth,
    checkAllDebridPinAuth,
    disconnectAllDebrid,
    startRealDebridDeviceAuth,
    checkRealDebridDeviceAuth,
    disconnectRealDebrid,
    selectPlayerExecutable,
    testMpcHcProgressConnection
} = require('../localBackendClient');
const styles = require('./DownloadManagerSettingsPanel.less');

const PRIMARY_CONCURRENCY_OPTIONS = [1, 2, 3, 4];
const UNLIMITED_CONCURRENT_DOWNLOADS = 'unlimited';

const DownloadManagerSettingsPanel = ({ onSettingsChange }) => {
    const { t } = useTranslation();
    const mountedRef = React.useRef(false);
    const requestSequenceRef = React.useRef(0);
    const [settings, setSettings] = React.useState(null);
    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState(null);
    const [customOpen, setCustomOpen] = React.useState(false);
    const [customValue, setCustomValue] = React.useState('');
    const [customError, setCustomError] = React.useState(null);
    const [allDebridAuth, setAllDebridAuth] = React.useState(null);
    const [allDebridBusy, setAllDebridBusy] = React.useState(false);
    const [allDebridError, setAllDebridError] = React.useState(null);
    const [realDebridAuth, setRealDebridAuth] = React.useState(null);
    const [realDebridBusy, setRealDebridBusy] = React.useState(false);
    const [realDebridError, setRealDebridError] = React.useState(null);
    const [playerBusy, setPlayerBusy] = React.useState(false);
    const [playerError, setPlayerError] = React.useState(null);
    const [progressDraft, setProgressDraft] = React.useState({
        enabled: false,
        port: '13579',
        localhostOnlyConfirmed: false,
        watchedSyncEnabled: false
    });
    const [progressOperation, setProgressOperation] = React.useState(null);
    const [progressError, setProgressError] = React.useState(null);
    const [progressTestResult, setProgressTestResult] = React.useState(null);
    const progressBusy = progressOperation !== null;

    React.useEffect(() => {
        mountedRef.current = true;

        return () => {
            mountedRef.current = false;
            requestSequenceRef.current += 1;
        };
    }, []);

    const loadSettings = React.useCallback(async () => {
        const requestSequence = requestSequenceRef.current + 1;
        requestSequenceRef.current = requestSequence;
        setLoading(true);
        setError(null);

        try {
            const nextSettings = await getBackendSettings();
            if (mountedRef.current && requestSequence === requestSequenceRef.current) {
                setSettings(nextSettings);
            }
        } catch (requestError) {
            if (mountedRef.current && requestSequence === requestSequenceRef.current) {
                setError(requestError?.backendError || t('CUSTOM_DOWNLOAD_MANAGER_SETTINGS_OFFLINE', {
                    defaultValue: 'Download options are unavailable. Check that the local backend is running.'
                }));
            }
        } finally {
            if (mountedRef.current && requestSequence === requestSequenceRef.current) {
                setLoading(false);
            }
        }
    }, [t]);

    React.useEffect(() => {
        loadSettings();
    }, [loadSettings]);

    const currentValue = settings?.downloads?.maxConcurrentDownloads;
    const hasCurrentValue = currentValue === UNLIMITED_CONCURRENT_DOWNLOADS || (Number.isSafeInteger(currentValue) && currentValue >= 1);
    const customSelected = Number.isSafeInteger(currentValue) && !PRIMARY_CONCURRENCY_OPTIONS.includes(currentValue);

    React.useEffect(() => {
        if (customSelected) {
            setCustomValue(`${currentValue}`);
        }
    }, [currentValue, customSelected]);

    const allDebridConnection = settings?.debrid?.allDebrid;
    const realDebridConnection = settings?.debrid?.realDebrid;
    const playerSettings = settings?.player;
    const playerExecutableName = playerSettings?.executablePath ?
        playerSettings.executablePath.split(/[\\/]/).pop()
        :
        null;

    React.useEffect(() => {
        const progressTracking = playerSettings?.progressTracking;
        if (!progressTracking) {
            return;
        }
        setProgressDraft({
            enabled: progressTracking.enabled === true,
            port: String(progressTracking.port || 13579),
            localhostOnlyConfirmed: progressTracking.localhostOnlyConfirmed === true,
            watchedSyncEnabled: progressTracking.watchedSyncEnabled === true
        });
    }, [
        playerSettings?.progressTracking?.enabled,
        playerSettings?.progressTracking?.port,
        playerSettings?.progressTracking?.localhostOnlyConfirmed,
        playerSettings?.progressTracking?.watchedSyncEnabled
    ]);

    const choosePlayerExecutable = React.useCallback(async () => {
        if (!settings || playerBusy) {
            return;
        }
        setPlayerBusy(true);
        setPlayerError(null);
        try {
            const nextSettings = await selectPlayerExecutable();
            if (mountedRef.current && nextSettings?.selectionCanceled !== true) {
                setSettings(nextSettings);
            }
        } catch (requestError) {
            if (mountedRef.current) {
                setPlayerError(requestError?.backendError || t('CUSTOM_DOWNLOAD_MANAGER_PLAYER_SELECT_ERROR', {
                    defaultValue: 'Could not open or save the video player selection.'
                }));
            }
        } finally {
            if (mountedRef.current) {
                setPlayerBusy(false);
            }
        }
    }, [settings, playerBusy, t]);

    const getProgressPort = React.useCallback(() => {
        const port = Number(progressDraft.port);
        return Number.isSafeInteger(port) && port >= 1 && port <= 65535 ? port : null;
    }, [progressDraft.port]);

    const saveProgressTracking = React.useCallback(async () => {
        if (!settings || progressBusy) {
            return;
        }
        const port = getProgressPort();
        if (port === null) {
            setProgressError(t('CUSTOM_DOWNLOAD_MANAGER_MPC_PORT_ERROR', {
                defaultValue: 'Enter a port between 1 and 65535.'
            }));
            return;
        }
        if (progressDraft.enabled && !progressDraft.localhostOnlyConfirmed) {
            setProgressError(t('CUSTOM_DOWNLOAD_MANAGER_MPC_LOCALHOST_REQUIRED', {
                defaultValue: 'Confirm the localhost-only MPC-HC setting before enabling progress tracking.'
            }));
            return;
        }

        setProgressOperation('save');
        setProgressError(null);
        try {
            const nextSettings = await updateBackendSettings({
                player: {
                    progressTracking: {
                        enabled: progressDraft.enabled,
                        port,
                        localhostOnlyConfirmed: progressDraft.localhostOnlyConfirmed,
                        watchedSyncEnabled: progressDraft.watchedSyncEnabled
                    }
                }
            });
            if (mountedRef.current) {
                setSettings(nextSettings);
                onSettingsChange?.(nextSettings);
            }
        } catch (requestError) {
            if (mountedRef.current) {
                setProgressError(requestError?.backendError || t('CUSTOM_DOWNLOAD_MANAGER_MPC_SAVE_ERROR', {
                    defaultValue: 'Could not save MPC-HC progress tracking settings.'
                }));
            }
        } finally {
            if (mountedRef.current) {
                setProgressOperation(null);
            }
        }
    }, [getProgressPort, onSettingsChange, progressBusy, progressDraft, settings, t]);

    const testProgressConnection = React.useCallback(async () => {
        if (!settings || progressBusy) {
            return;
        }
        const port = getProgressPort();
        if (port === null) {
            setProgressError(t('CUSTOM_DOWNLOAD_MANAGER_MPC_PORT_ERROR', {
                defaultValue: 'Enter a port between 1 and 65535.'
            }));
            return;
        }

        setProgressOperation('test');
        setProgressError(null);
        setProgressTestResult(null);
        try {
            const result = await testMpcHcProgressConnection(port);
            if (mountedRef.current) {
                setProgressTestResult(result);
            }
        } catch (requestError) {
            if (mountedRef.current) {
                setProgressError(requestError?.backendError || t('CUSTOM_DOWNLOAD_MANAGER_MPC_TEST_ERROR', {
                    defaultValue: 'Could not connect. Open MPC-HC, enable its Web Interface, and verify the port.'
                }));
            }
        } finally {
            if (mountedRef.current) {
                setProgressOperation(null);
            }
        }
    }, [getProgressPort, progressBusy, settings, t]);

    const startAllDebridConnection = React.useCallback(async () => {
        if (allDebridBusy) {
            return;
        }
        setAllDebridBusy(true);
        setAllDebridError(null);
        try {
            const auth = await startAllDebridPinAuth();
            if (mountedRef.current) {
                setAllDebridAuth(auth);
            }
        } catch (requestError) {
            if (mountedRef.current) {
                setAllDebridError(requestError?.backendError || t('CUSTOM_DOWNLOAD_MANAGER_ALLDEBRID_CONNECT_ERROR', {
                    defaultValue: 'Could not start the AllDebrid connection.'
                }));
            }
        } finally {
            if (mountedRef.current) {
                setAllDebridBusy(false);
            }
        }
    }, [allDebridBusy, t]);

    const disconnectAllDebridConnection = React.useCallback(async () => {
        if (allDebridBusy) {
            return;
        }
        setAllDebridBusy(true);
        setAllDebridError(null);
        try {
            const result = await disconnectAllDebrid();
            if (mountedRef.current) {
                setSettings((current) => ({
                    ...current,
                    debrid: { ...current?.debrid, allDebrid: result.connection }
                }));
                setAllDebridAuth(null);
            }
        } catch (requestError) {
            if (mountedRef.current) {
                setAllDebridError(requestError?.backendError || t('CUSTOM_DOWNLOAD_MANAGER_ALLDEBRID_DISCONNECT_ERROR', {
                    defaultValue: 'Could not disconnect AllDebrid.'
                }));
            }
        } finally {
            if (mountedRef.current) {
                setAllDebridBusy(false);
            }
        }
    }, [allDebridBusy, t]);

    React.useEffect(() => {
        if (!allDebridAuth || allDebridConnection?.connected) {
            return undefined;
        }

        let canceled = false;
        let requestPending = false;
        const poll = async () => {
            if (requestPending || canceled) {
                return;
            }
            if (Date.parse(allDebridAuth.expiresAt) <= Date.now()) {
                setAllDebridAuth(null);
                setAllDebridError(t('CUSTOM_DOWNLOAD_MANAGER_ALLDEBRID_PIN_EXPIRED', {
                    defaultValue: 'The AllDebrid PIN expired. Start a new connection.'
                }));
                return;
            }

            requestPending = true;
            try {
                const result = await checkAllDebridPinAuth();
                if (!canceled && mountedRef.current && result.activated) {
                    setSettings((current) => ({
                        ...current,
                        debrid: { ...current?.debrid, allDebrid: result.connection }
                    }));
                    setAllDebridAuth(null);
                    setAllDebridError(null);
                }
            } catch (requestError) {
                if (!canceled && mountedRef.current && [409, 410].includes(requestError?.status)) {
                    setAllDebridAuth(null);
                    setAllDebridError(requestError?.backendError || t('CUSTOM_DOWNLOAD_MANAGER_ALLDEBRID_PIN_INACTIVE', {
                        defaultValue: 'The AllDebrid PIN is no longer active.'
                    }));
                }
            } finally {
                requestPending = false;
            }
        };

        const firstPoll = setTimeout(poll, 1200);
        const interval = setInterval(poll, 3000);
        return () => {
            canceled = true;
            clearTimeout(firstPoll);
            clearInterval(interval);
        };
    }, [allDebridAuth, allDebridConnection?.connected, t]);

    const startRealDebridConnection = React.useCallback(async () => {
        if (realDebridBusy) {
            return;
        }
        setRealDebridBusy(true);
        setRealDebridError(null);
        try {
            const auth = await startRealDebridDeviceAuth();
            if (mountedRef.current) {
                setRealDebridAuth(auth);
            }
        } catch (requestError) {
            if (mountedRef.current) {
                setRealDebridError(requestError?.backendError || t('CUSTOM_DOWNLOAD_MANAGER_REALDEBRID_CONNECT_ERROR', {
                    defaultValue: 'Could not start the Real-Debrid connection.'
                }));
            }
        } finally {
            if (mountedRef.current) {
                setRealDebridBusy(false);
            }
        }
    }, [realDebridBusy, t]);

    const disconnectRealDebridConnection = React.useCallback(async () => {
        if (realDebridBusy) {
            return;
        }
        setRealDebridBusy(true);
        setRealDebridError(null);
        try {
            const result = await disconnectRealDebrid();
            if (mountedRef.current) {
                setSettings((current) => ({
                    ...current,
                    debrid: { ...current?.debrid, realDebrid: result.connection }
                }));
                setRealDebridAuth(null);
            }
        } catch (requestError) {
            if (mountedRef.current) {
                setRealDebridError(requestError?.backendError || t('CUSTOM_DOWNLOAD_MANAGER_REALDEBRID_DISCONNECT_ERROR', {
                    defaultValue: 'Could not disconnect Real-Debrid.'
                }));
            }
        } finally {
            if (mountedRef.current) {
                setRealDebridBusy(false);
            }
        }
    }, [realDebridBusy, t]);

    React.useEffect(() => {
        if (!realDebridAuth || realDebridConnection?.connected) {
            return undefined;
        }

        let canceled = false;
        let requestPending = false;
        const poll = async () => {
            if (requestPending || canceled) {
                return;
            }
            if (Date.parse(realDebridAuth.expiresAt) <= Date.now()) {
                setRealDebridAuth(null);
                setRealDebridError(t('CUSTOM_DOWNLOAD_MANAGER_REALDEBRID_CODE_EXPIRED', {
                    defaultValue: 'The Real-Debrid authorization code expired. Start a new connection.'
                }));
                return;
            }

            requestPending = true;
            try {
                const result = await checkRealDebridDeviceAuth();
                if (!canceled && mountedRef.current && result.activated) {
                    setSettings((current) => ({
                        ...current,
                        debrid: { ...current?.debrid, realDebrid: result.connection }
                    }));
                    setRealDebridAuth(null);
                    setRealDebridError(null);
                }
            } catch (requestError) {
                if (!canceled && mountedRef.current && [409, 410].includes(requestError?.status)) {
                    setRealDebridAuth(null);
                    setRealDebridError(requestError?.backendError || t('CUSTOM_DOWNLOAD_MANAGER_REALDEBRID_CODE_INACTIVE', {
                        defaultValue: 'The Real-Debrid authorization code is no longer active.'
                    }));
                }
            } finally {
                requestPending = false;
            }
        };

        const intervalMs = Math.max(3, Number(realDebridAuth.intervalSeconds) || 5) * 1000;
        const firstPoll = setTimeout(poll, intervalMs);
        const interval = setInterval(poll, intervalMs);
        return () => {
            canceled = true;
            clearTimeout(firstPoll);
            clearInterval(interval);
        };
    }, [realDebridAuth, realDebridConnection?.connected, t]);

    const selectConcurrency = React.useCallback(async (maxConcurrentDownloads) => {
        if (!settings || saving || maxConcurrentDownloads === currentValue) {
            return maxConcurrentDownloads === currentValue;
        }

        setSaving(true);
        setError(null);
        try {
            const nextSettings = await updateBackendSettings({
                downloads: { maxConcurrentDownloads }
            });
            if (mountedRef.current) {
                setSettings(nextSettings);
            }
            return true;
        } catch (requestError) {
            if (mountedRef.current) {
                setError(requestError?.backendError || t('CUSTOM_DOWNLOAD_MANAGER_SETTINGS_SAVE_ERROR', {
                    defaultValue: 'Could not save this option. Your previous limit is still active.'
                }));
            }
            return false;
        } finally {
            if (mountedRef.current) {
                setSaving(false);
            }
        }
    }, [currentValue, saving, settings, t]);

    const openCustomEditor = React.useCallback(() => {
        if (saving) {
            return;
        }
        setCustomValue(customSelected ? `${currentValue}` : '');
        setCustomError(null);
        setCustomOpen(true);
    }, [currentValue, customSelected, saving]);

    const submitCustomValue = React.useCallback(async (event) => {
        event.preventDefault();
        const parsedValue = Number(customValue.trim());
        if (!Number.isSafeInteger(parsedValue) || parsedValue < 1) {
            setCustomError(t('CUSTOM_DOWNLOAD_MANAGER_CUSTOM_ERROR', {
                defaultValue: 'Enter a positive whole number.'
            }));
            return;
        }

        setCustomError(null);
        if (await selectConcurrency(parsedValue)) {
            setCustomOpen(false);
        }
    }, [customValue, selectConcurrency, t]);

    return (
        <div className={styles['options-stack']}>
            <section className={styles['settings-panel']} aria-labelledby={'download-manager-settings-title'}>
                <div className={styles['settings-copy']}>
                    <h2 id={'download-manager-settings-title'}>
                        {t('CUSTOM_DOWNLOAD_MANAGER_SIMULTANEOUS', { defaultValue: 'Simultaneous downloads' })}
                    </h2>
                    <p>
                        {t('CUSTOM_DOWNLOAD_MANAGER_SIMULTANEOUS_DESCRIPTION', {
                            defaultValue: 'Choose how many files can transfer at once. Changes apply immediately without interrupting active downloads.'
                        })}
                    </p>
                </div>
                <div className={styles['settings-control']}>
                    {
                        settings && hasCurrentValue ?
                            <div className={styles['choice-group']} role={'group'} aria-label={t('CUSTOM_DOWNLOAD_MANAGER_SIMULTANEOUS', { defaultValue: 'Simultaneous downloads' })}>
                                {PRIMARY_CONCURRENCY_OPTIONS.map((value) => (
                                    <Button
                                        key={value}
                                        className={value === currentValue ? styles['choice-selected'] : styles['choice']}
                                        aria-pressed={value === currentValue}
                                        aria-disabled={saving}
                                        disabled={saving}
                                        title={t('CUSTOM_DOWNLOAD_MANAGER_DOWNLOAD_COUNT', {
                                            defaultValue: value === 1 ? '1 download at a time' : '{{count}} downloads at a time',
                                            count: value
                                        })}
                                        onClick={() => selectConcurrency(value)}
                                    >
                                        {value}
                                    </Button>
                                ))}
                                <Button
                                    className={customSelected ? styles['mode-choice-selected'] : styles['mode-choice']}
                                    aria-pressed={customSelected}
                                    aria-expanded={customOpen}
                                    aria-disabled={saving}
                                    disabled={saving}
                                    onClick={openCustomEditor}
                                >
                                    {customSelected ?
                                        t('CUSTOM_DOWNLOAD_MANAGER_CUSTOM_VALUE', { defaultValue: 'Custom ({{count}})', count: currentValue })
                                        :
                                        t('CUSTOM_DOWNLOAD_MANAGER_CUSTOM', { defaultValue: 'Custom' })}
                                </Button>
                                <Button
                                    className={currentValue === UNLIMITED_CONCURRENT_DOWNLOADS ? styles['mode-choice-selected'] : styles['mode-choice']}
                                    aria-pressed={currentValue === UNLIMITED_CONCURRENT_DOWNLOADS}
                                    aria-disabled={saving}
                                    disabled={saving}
                                    title={t('CUSTOM_DOWNLOAD_MANAGER_UNLIMITED_DESCRIPTION', {
                                        defaultValue: 'Start every queued download without a concurrency limit.'
                                    })}
                                    onClick={() => selectConcurrency(UNLIMITED_CONCURRENT_DOWNLOADS)}
                                >
                                    {t('CUSTOM_DOWNLOAD_MANAGER_UNLIMITED', { defaultValue: 'Unlimited' })}
                                </Button>
                            </div>
                            :
                            <div className={styles['loading-state']} aria-live={'polite'}>
                                {loading ?
                                    t('CUSTOM_DOWNLOAD_MANAGER_SETTINGS_LOADING', { defaultValue: 'Loading download options...' })
                                    :
                                    t('CUSTOM_DOWNLOAD_MANAGER_SETTINGS_UNAVAILABLE', { defaultValue: 'Options unavailable' })}
                            </div>
                    }
                    <div className={styles['control-status']} aria-live={'polite'}>
                        {saving ? t('CUSTOM_DOWNLOAD_MANAGER_SETTINGS_SAVING', { defaultValue: 'Saving...' }) : null}
                    </div>
                </div>
                {
                    customOpen ?
                        <form className={styles['custom-editor']} onSubmit={submitCustomValue}>
                            <label htmlFor={'custom-download-concurrency'}>
                                {t('CUSTOM_DOWNLOAD_MANAGER_CUSTOM_LABEL', { defaultValue: 'Maximum simultaneous downloads' })}
                            </label>
                            <div className={styles['custom-input-row']}>
                                <input
                                    id={'custom-download-concurrency'}
                                    type={'number'}
                                    min={'1'}
                                    step={'1'}
                                    inputMode={'numeric'}
                                    value={customValue}
                                    disabled={saving}
                                    placeholder={'5'}
                                    onChange={(event) => {
                                        setCustomValue(event.target.value);
                                        setCustomError(null);
                                    }}
                                />
                                <button className={styles['apply-button']} disabled={saving} type={'submit'}>
                                    {t('CUSTOM_DOWNLOAD_MANAGER_CUSTOM_APPLY', { defaultValue: 'Apply' })}
                                </button>
                                <button
                                    className={styles['cancel-button']}
                                    disabled={saving}
                                    type={'button'}
                                    onClick={() => {
                                        setCustomOpen(false);
                                        setCustomError(null);
                                    }}
                                >
                                    {t('CUSTOM_DOWNLOAD_MANAGER_CUSTOM_CANCEL', { defaultValue: 'Cancel' })}
                                </button>
                            </div>
                            {customError ? <span className={styles['custom-error']} role={'alert'}>{customError}</span> : null}
                        </form>
                        :
                        null
                }
                {
                    currentValue === UNLIMITED_CONCURRENT_DOWNLOADS ?
                        <div className={styles['unlimited-note']} role={'status'}>
                            {t('CUSTOM_DOWNLOAD_MANAGER_UNLIMITED_NOTE', {
                                defaultValue: 'Unlimited starts every queued transfer and may use substantial bandwidth and system resources.'
                            })}
                        </div>
                        :
                        null
                }
                {
                    error ?
                        <div className={styles['error-row']} role={'alert'}>
                            <span>{error}</span>
                            {
                                !settings ?
                                    <Button className={styles['retry-button']} disabled={loading} onClick={loadSettings}>
                                        {t('CUSTOM_DOWNLOAD_MANAGER_SETTINGS_RETRY', { defaultValue: 'Retry' })}
                                    </Button>
                                    :
                                    null
                            }
                        </div>
                        :
                        null
                }
            </section>
            <section className={styles['player-panel']} aria-labelledby={'download-manager-player-title'}>
                <div className={styles['settings-copy']}>
                    <div className={styles['player-heading-row']}>
                        <h2 id={'download-manager-player-title'}>
                            {t('CUSTOM_DOWNLOAD_MANAGER_PLAYER_TITLE', { defaultValue: 'Video player' })}
                        </h2>
                        {
                            playerSettings?.configured ?
                                <span className={styles['player-configured']}>
                                    {t('CUSTOM_DOWNLOAD_MANAGER_PLAYER_READY', { defaultValue: 'Ready' })}
                                </span>
                                : null
                        }
                    </div>
                    <p>
                        {t('CUSTOM_DOWNLOAD_MANAGER_PLAYER_DESCRIPTION', {
                            defaultValue: 'Choose the Windows .exe used to play completed downloads. The path is stored only by the local backend.'
                        })}
                    </p>
                </div>
                <div className={styles['player-control']}>
                    {
                        !settings ?
                            <span className={styles['player-muted']}>
                                {t('CUSTOM_DOWNLOAD_MANAGER_PLAYER_BACKEND_WAIT', { defaultValue: 'Waiting for the local backend...' })}
                            </span>
                            :
                            <React.Fragment>
                                <div className={styles['player-path-copy']} title={playerSettings?.executablePath || undefined}>
                                    <strong>{playerExecutableName || t('CUSTOM_DOWNLOAD_MANAGER_PLAYER_NOT_SELECTED', { defaultValue: 'No player selected' })}</strong>
                                    <span>{playerSettings?.executablePath || t('CUSTOM_DOWNLOAD_MANAGER_PLAYER_SELECT_PROMPT', { defaultValue: 'Select MPC-HC or another video player executable.' })}</span>
                                </div>
                                <button
                                    className={styles['player-select-button']}
                                    type={'button'}
                                    disabled={playerBusy}
                                    onClick={choosePlayerExecutable}
                                >
                                    {playerBusy ?
                                        t('CUSTOM_DOWNLOAD_MANAGER_PLAYER_CHOOSING', { defaultValue: 'Choosing...' })
                                        : playerSettings?.configured ?
                                            t('CUSTOM_DOWNLOAD_MANAGER_PLAYER_CHANGE', { defaultValue: 'Change player' })
                                            :
                                            t('CUSTOM_DOWNLOAD_MANAGER_PLAYER_CHOOSE', { defaultValue: 'Choose player' })}
                                </button>
                            </React.Fragment>
                    }
                </div>
                {playerError ? <div className={styles['error-row']} role={'alert'}>{playerError}</div> : null}
            </section>
            <section className={styles['progress-panel']} aria-labelledby={'download-manager-progress-title'}>
                <div className={styles['progress-intro']}>
                    <div className={styles['player-heading-row']}>
                        <h2 id={'download-manager-progress-title'}>
                            {t('CUSTOM_DOWNLOAD_MANAGER_MPC_PROGRESS_TITLE', { defaultValue: 'MPC-HC playback progress' })}
                        </h2>
                        {
                            playerSettings?.progressTracking?.enabled ?
                                <span className={styles['progress-enabled']}>
                                    {t('CUSTOM_DOWNLOAD_MANAGER_MPC_PROGRESS_ENABLED', { defaultValue: 'Tracking enabled' })}
                                </span>
                                : null
                        }
                    </div>
                    <p>
                        {t('CUSTOM_DOWNLOAD_MANAGER_MPC_PROGRESS_DESCRIPTION', {
                            defaultValue: 'Observe local playback for future watched and Continue Watching features. MPC-HC still controls resume position.'
                        })}
                    </p>
                    <ol className={styles['progress-setup']}>
                        <li>{t('CUSTOM_DOWNLOAD_MANAGER_MPC_SETUP_WEB', { defaultValue: 'In MPC-HC, open Options → Player → Web Interface and enable Listen on port.' })}</li>
                        <li><strong>{t('CUSTOM_DOWNLOAD_MANAGER_MPC_SETUP_LOCAL', { defaultValue: 'Enable Allow access from localhost only.' })}</strong></li>
                        <li>{t('CUSTOM_DOWNLOAD_MANAGER_MPC_SETUP_HISTORY', { defaultValue: 'Under Player → History, enable Keep history and Remember File position.' })}</li>
                    </ol>
                </div>
                <div className={styles['progress-controls']}>
                    <label className={styles['progress-toggle']}>
                        <input
                            type={'checkbox'}
                            checked={progressDraft.enabled}
                            disabled={!settings || progressBusy}
                            onChange={(event) => {
                                setProgressDraft((current) => ({ ...current, enabled: event.target.checked }));
                                setProgressError(null);
                            }}
                        />
                        <span className={styles['progress-checkbox']} aria-hidden={'true'} />
                        <span>{t('CUSTOM_DOWNLOAD_MANAGER_MPC_ENABLE', { defaultValue: 'Enable progress tracking' })}</span>
                    </label>
                    <label className={styles['progress-port']} htmlFor={'mpc-hc-web-port'}>
                        <span>{t('CUSTOM_DOWNLOAD_MANAGER_MPC_PORT', { defaultValue: 'Web Interface port' })}</span>
                        <input
                            id={'mpc-hc-web-port'}
                            type={'number'}
                            min={'1'}
                            max={'65535'}
                            step={'1'}
                            inputMode={'numeric'}
                            value={progressDraft.port}
                            disabled={!settings || progressBusy}
                            onChange={(event) => {
                                setProgressDraft((current) => ({ ...current, port: event.target.value }));
                                setProgressError(null);
                                setProgressTestResult(null);
                            }}
                        />
                    </label>
                    <label className={styles['progress-confirmation']}>
                        <input
                            type={'checkbox'}
                            checked={progressDraft.localhostOnlyConfirmed}
                            disabled={!settings || progressBusy}
                            onChange={(event) => {
                                setProgressDraft((current) => ({ ...current, localhostOnlyConfirmed: event.target.checked }));
                                setProgressError(null);
                            }}
                        />
                        <span className={styles['progress-checkbox']} aria-hidden={'true'} />
                        <span>{t('CUSTOM_DOWNLOAD_MANAGER_MPC_CONFIRM_LOCALHOST', { defaultValue: 'I enabled “Allow access from localhost only” in MPC-HC.' })}</span>
                    </label>
                    <label className={styles['progress-confirmation']}>
                        <input
                            type={'checkbox'}
                            checked={progressDraft.watchedSyncEnabled}
                            disabled={!settings || !progressDraft.enabled || progressBusy}
                            onChange={(event) => {
                                setProgressDraft((current) => ({ ...current, watchedSyncEnabled: event.target.checked }));
                                setProgressError(null);
                            }}
                        />
                        <span className={styles['progress-checkbox']} aria-hidden={'true'} />
                        <span>{t('CUSTOM_DOWNLOAD_MANAGER_MPC_WATCH_SYNC', {
                            defaultValue: 'Show verified MPC-HC resume progress on Home and sync completed movies after verified 90% playback'
                        })}</span>
                    </label>
                    <div className={styles['progress-actions']}>
                        <button
                            className={styles['progress-test-button']}
                            type={'button'}
                            disabled={!settings || progressBusy}
                            onClick={testProgressConnection}
                        >
                            {progressOperation === 'test' ?
                                t('CUSTOM_DOWNLOAD_MANAGER_MPC_WORKING', { defaultValue: 'Checking...' })
                                :
                                t('CUSTOM_DOWNLOAD_MANAGER_MPC_TEST', { defaultValue: 'Test connection' })}
                        </button>
                        <button
                            className={styles['progress-save-button']}
                            type={'button'}
                            disabled={!settings || progressBusy}
                            onClick={saveProgressTracking}
                        >
                            {progressOperation === 'save' ?
                                t('CUSTOM_DOWNLOAD_MANAGER_MPC_SAVING', { defaultValue: 'Saving...' })
                                :
                                t('CUSTOM_DOWNLOAD_MANAGER_MPC_SAVE', { defaultValue: 'Save' })}
                        </button>
                    </div>
                    <div className={styles['progress-status']} aria-live={'polite'}>
                        {
                            progressTestResult?.connected ?
                                <span className={styles['progress-success']}>
                                    {progressTestResult.playerActive ?
                                        t('CUSTOM_DOWNLOAD_MANAGER_MPC_CONNECTED_ACTIVE', { defaultValue: 'Connected. MPC-HC is reporting an open media file.' })
                                        :
                                        t('CUSTOM_DOWNLOAD_MANAGER_MPC_CONNECTED_IDLE', { defaultValue: 'Connected. MPC-HC is ready; no media is currently open.' })}
                                </span>
                                : null
                        }
                        {progressError ? <span className={styles['progress-error']} role={'alert'}>{progressError}</span> : null}
                    </div>
                </div>
            </section>
            <section className={styles['debrid-panel']} aria-labelledby={'download-manager-alldebrid-title'}>
                <div className={styles['settings-copy']}>
                    <div className={styles['debrid-heading-row']}>
                        <h2 id={'download-manager-alldebrid-title'}>
                            {t('CUSTOM_DOWNLOAD_MANAGER_ALLDEBRID_TITLE', { defaultValue: 'AllDebrid account' })}
                        </h2>
                        {
                            allDebridConnection?.connected ?
                                <span className={allDebridConnection.isPremium ? styles['connection-premium'] : styles['connection-basic']}>
                                    {allDebridConnection.isPremium ?
                                        t('CUSTOM_DOWNLOAD_MANAGER_ALLDEBRID_PREMIUM_CONNECTED', { defaultValue: 'Premium connected' })
                                        :
                                        t('CUSTOM_DOWNLOAD_MANAGER_ALLDEBRID_CONNECTED', { defaultValue: 'Connected' })}
                                </span>
                                : null
                        }
                    </div>
                    <p>
                        {t('CUSTOM_DOWNLOAD_MANAGER_ALLDEBRID_DESCRIPTION', {
                            defaultValue: 'Connect your account for future explicit debrid actions. Browsing sources uses local provider labels and never creates an AllDebrid magnet.'
                        })}
                    </p>
                </div>
                <div className={styles['debrid-control']}>
                    {
                        !settings ?
                            <span className={styles['debrid-muted']}>
                                {t('CUSTOM_DOWNLOAD_MANAGER_ALLDEBRID_BACKEND_WAIT', { defaultValue: 'Waiting for the local backend...' })}
                            </span>
                            : allDebridConnection?.connected ?
                                <React.Fragment>
                                    <div className={styles['account-copy']}>
                                        <strong>{allDebridConnection.username || t('CUSTOM_DOWNLOAD_MANAGER_ALLDEBRID_ACCOUNT', { defaultValue: 'AllDebrid account' })}</strong>
                                        <span>{allDebridConnection.isPremium ?
                                            t('CUSTOM_DOWNLOAD_MANAGER_ALLDEBRID_ENABLED', { defaultValue: 'Connected. Source browsing does not modify your account.' })
                                            :
                                            t('CUSTOM_DOWNLOAD_MANAGER_ALLDEBRID_PREMIUM_REQUIRED', { defaultValue: 'Connected, but this account is not currently premium.' })}</span>
                                    </div>
                                    <button
                                        className={styles['disconnect-button']}
                                        type={'button'}
                                        disabled={allDebridBusy}
                                        onClick={disconnectAllDebridConnection}
                                    >
                                        {allDebridBusy ?
                                            t('CUSTOM_DOWNLOAD_MANAGER_ALLDEBRID_DISCONNECTING', { defaultValue: 'Disconnecting...' })
                                            :
                                            t('CUSTOM_DOWNLOAD_MANAGER_ALLDEBRID_DISCONNECT', { defaultValue: 'Disconnect' })}
                                    </button>
                                </React.Fragment>
                                : allDebridAuth ?
                                    <div className={styles['pin-flow']}>
                                        <div>
                                            <span className={styles['pin-label']}>
                                                {t('CUSTOM_DOWNLOAD_MANAGER_ALLDEBRID_PIN_LABEL', { defaultValue: 'Enter this PIN on AllDebrid' })}
                                            </span>
                                            <strong className={styles['pin-code']}>{allDebridAuth.pin}</strong>
                                        </div>
                                        <a className={styles['connect-link']} href={allDebridAuth.userUrl} target={'_blank'} rel={'noreferrer'}>
                                            {t('CUSTOM_DOWNLOAD_MANAGER_ALLDEBRID_OPEN', { defaultValue: 'Open AllDebrid' })}
                                        </a>
                                        <span className={styles['polling-label']}>
                                            {t('CUSTOM_DOWNLOAD_MANAGER_ALLDEBRID_AUTH_WAIT', { defaultValue: 'Waiting for authorization...' })}
                                        </span>
                                    </div>
                                    :
                                    <button
                                        className={styles['connect-button']}
                                        type={'button'}
                                        disabled={allDebridBusy}
                                        onClick={startAllDebridConnection}
                                    >
                                        {allDebridBusy ?
                                            t('CUSTOM_DOWNLOAD_MANAGER_ALLDEBRID_CONNECTING', { defaultValue: 'Connecting...' })
                                            :
                                            t('CUSTOM_DOWNLOAD_MANAGER_ALLDEBRID_CONNECT', { defaultValue: 'Connect AllDebrid' })}
                                    </button>
                    }
                </div>
                {
                    allDebridConnection?.pendingCleanup > 0 ?
                        <div className={styles['cleanup-warning']} role={'status'}>
                            {t('CUSTOM_DOWNLOAD_MANAGER_ALLDEBRID_CLEANUP_PENDING', {
                                defaultValue: '{{count}} temporary magnet cleanup item(s) pending. The backend will retry automatically.',
                                count: allDebridConnection.pendingCleanup
                            })}
                        </div>
                        : null
                }
                {allDebridError ? <div className={styles['error-row']} role={'alert'}>{allDebridError}</div> : null}
            </section>
            <section className={styles['realdebrid-panel']} aria-labelledby={'download-manager-realdebrid-title'}>
                <div className={styles['settings-copy']}>
                    <div className={styles['debrid-heading-row']}>
                        <h2 id={'download-manager-realdebrid-title'}>
                            {t('CUSTOM_DOWNLOAD_MANAGER_REALDEBRID_TITLE', { defaultValue: 'Real-Debrid account' })}
                        </h2>
                        {
                            realDebridConnection?.connected ?
                                <span className={realDebridConnection.isPremium ? styles['realdebrid-premium'] : styles['connection-basic']}>
                                    {realDebridConnection.isPremium ?
                                        t('CUSTOM_DOWNLOAD_MANAGER_REALDEBRID_PREMIUM_CONNECTED', { defaultValue: 'Premium connected' })
                                        :
                                        t('CUSTOM_DOWNLOAD_MANAGER_REALDEBRID_CONNECTED', { defaultValue: 'Connected' })}
                                </span>
                                : null
                        }
                    </div>
                    <p>
                        {t('CUSTOM_DOWNLOAD_MANAGER_REALDEBRID_DESCRIPTION', {
                            defaultValue: 'Connect through Real-Debrid device authorization. Browsing stays read-only; an explicit source check briefly creates and removes a temporary torrent.'
                        })}
                    </p>
                </div>
                <div className={styles['debrid-control']}>
                    {
                        !settings ?
                            <span className={styles['debrid-muted']}>
                                {t('CUSTOM_DOWNLOAD_MANAGER_REALDEBRID_BACKEND_WAIT', { defaultValue: 'Waiting for the local backend...' })}
                            </span>
                            : realDebridConnection?.connected ?
                                <React.Fragment>
                                    <div className={styles['account-copy']}>
                                        <strong>{realDebridConnection.username || t('CUSTOM_DOWNLOAD_MANAGER_REALDEBRID_ACCOUNT', { defaultValue: 'Real-Debrid account' })}</strong>
                                        <span>{realDebridConnection.isPremium ?
                                            t('CUSTOM_DOWNLOAD_MANAGER_REALDEBRID_ENABLED', { defaultValue: 'Connected securely. No torrent is added during source browsing.' })
                                            :
                                            t('CUSTOM_DOWNLOAD_MANAGER_REALDEBRID_PREMIUM_REQUIRED', { defaultValue: 'Connected, but this account is not currently premium.' })}</span>
                                    </div>
                                    <button
                                        className={styles['disconnect-button']}
                                        type={'button'}
                                        disabled={realDebridBusy}
                                        onClick={disconnectRealDebridConnection}
                                    >
                                        {realDebridBusy ?
                                            t('CUSTOM_DOWNLOAD_MANAGER_REALDEBRID_DISCONNECTING', { defaultValue: 'Disconnecting...' })
                                            :
                                            t('CUSTOM_DOWNLOAD_MANAGER_REALDEBRID_DISCONNECT', { defaultValue: 'Disconnect' })}
                                    </button>
                                </React.Fragment>
                                : realDebridAuth ?
                                    <div className={styles['pin-flow']}>
                                        <div>
                                            <span className={styles['pin-label']}>
                                                {t('CUSTOM_DOWNLOAD_MANAGER_REALDEBRID_CODE_LABEL', { defaultValue: 'Enter this code on Real-Debrid' })}
                                            </span>
                                            <strong className={styles['realdebrid-code']}>{realDebridAuth.userCode}</strong>
                                        </div>
                                        <a className={styles['realdebrid-connect-link']} href={realDebridAuth.verificationUrl} target={'_blank'} rel={'noreferrer'}>
                                            {t('CUSTOM_DOWNLOAD_MANAGER_REALDEBRID_OPEN', { defaultValue: 'Open Real-Debrid' })}
                                        </a>
                                        <span className={styles['polling-label']}>
                                            {t('CUSTOM_DOWNLOAD_MANAGER_REALDEBRID_AUTH_WAIT', { defaultValue: 'Waiting for authorization...' })}
                                        </span>
                                    </div>
                                    :
                                    <button
                                        className={styles['realdebrid-connect-button']}
                                        type={'button'}
                                        disabled={realDebridBusy}
                                        onClick={startRealDebridConnection}
                                    >
                                        {realDebridBusy ?
                                            t('CUSTOM_DOWNLOAD_MANAGER_REALDEBRID_CONNECTING', { defaultValue: 'Connecting...' })
                                            :
                                            t('CUSTOM_DOWNLOAD_MANAGER_REALDEBRID_CONNECT', { defaultValue: 'Connect Real-Debrid' })}
                                    </button>
                    }
                </div>
                {
                    realDebridConnection?.pendingCleanup > 0 ?
                        <div className={styles['cleanup-warning']} role={'status'}>
                            {t('CUSTOM_DOWNLOAD_MANAGER_REALDEBRID_CLEANUP_PENDING', {
                                defaultValue: '{{count}} temporary Real-Debrid cleanup item(s) pending. The backend will retry automatically.',
                                count: realDebridConnection.pendingCleanup
                            })}
                        </div>
                        : null
                }
                {realDebridError ? <div className={styles['error-row']} role={'alert'}>{realDebridError}</div> : null}
            </section>
        </div>
    );
};

DownloadManagerSettingsPanel.propTypes = {
    onSettingsChange: PropTypes.func
};

module.exports = DownloadManagerSettingsPanel;

const React = require('react');
const PropTypes = require('prop-types');
const { useTranslation } = require('react-i18next');
const { ModalDialog } = require('stremio/components');
const SelectMenu = require('./SelectMenu');
const { getBackendDiagnostics, checkBackendConnections, updateBackendSettings } = require('../localBackendClient');
const { subscribeStatus, getStatus } = require('../externalPlaybackSync');
const { getDownloadActionError } = require('../downloadRecordPresentation');
const styles = require('./DownloadHealthPanel.less');

const STATE_LABELS = { ok: 'Ready', warning: 'Check', unverified: 'Not checked', off: 'Optional' };
const checkBrowsingEngine = async () => {
    if (!window.core?.getState) return false;
    let timeout;
    try {
        return await Promise.race([
            window.core.getState('ctx').then(() => true),
            new Promise((resolve) => { timeout = setTimeout(() => resolve(false), 5000); })
        ]);
    } catch { return false; }
    finally { clearTimeout(timeout); }
};
const DownloadHealthPanel = ({ onSettingsChange }) => {
    const { t } = useTranslation();
    const desktop = window.customStremioDesktop;
    const sync = React.useSyncExternalStore(subscribeStatus, getStatus, getStatus);
    const [report, setReport] = React.useState(null);
    const [desktopSettings, setDesktopSettings] = React.useState(null);
    const [busy, setBusy] = React.useState(null);
    const [error, setError] = React.useState('');
    const [notice, setNotice] = React.useState('');
    const [confirmation, setConfirmation] = React.useState(null);
    const [coreReady, setCoreReady] = React.useState(false);
    const mounted = React.useRef(false);
    const operation = React.useRef(false);
    const refresh = React.useCallback(async (connections = false) => {
        if (operation.current || !mounted.current) return;
        operation.current = true;
        setBusy(connections ? 'connections' : 'refresh');
        setError('');
        const results = await Promise.allSettled([
            connections ? checkBackendConnections() : getBackendDiagnostics(),
            desktop?.getDesktopSettings ? desktop.getDesktopSettings() : Promise.resolve(null),
            checkBrowsingEngine()
        ]);
        if (mounted.current) {
            if (results[0].status === 'fulfilled') setReport(results[0].value);
            else setError(connections ? 'Connection checks did not finish. Refresh local health; a provider may be slow or unavailable.' :
                'The download service did not respond. Use Restart service below, or Quit and reopen the app.');
            if (results[1].status === 'fulfilled') setDesktopSettings(results[1].value);
            setCoreReady(results[2].status === 'fulfilled' && results[2].value);
            setBusy(null);
        }
        operation.current = false;
    }, [desktop]);
    React.useEffect(() => {
        mounted.current = true;
        refresh();
        return () => { mounted.current = false; };
    }, [refresh]);
    const runAction = async (name, action) => {
        if (operation.current) return;
        operation.current = true;
        setBusy(name);
        setError('');
        setNotice('');
        try { await action(); }
        catch (requestError) {
            if (mounted.current) setError(requestError?.backendError || 'The action could not finish. Refresh health and try again.');
        } finally {
            operation.current = false;
            if (mounted.current) setBusy(null);
        }
    };
    const reset = async () => {
        const selected = confirmation;
        setConfirmation(null);
        await runAction('reset', async () => {
            if (selected === 'options') {
                const settings = await updateBackendSettings({ downloads: { maxConcurrentDownloads: 2 } });
                if (mounted.current) onSettingsChange(settings);
            } else localStorage.removeItem('customStremio.batchDownloadSession');
            if (mounted.current) setNotice(selected === 'options' ? 'Simultaneous downloads reset to 2.' : 'Saved episode selection cleared. You can select episodes again.');
        });
        await refresh();
    };
    const issue = report?.lastRejection;
    return (
        <section className={styles['health-panel']} aria-labelledby={'download-health-title'}>
            <div className={styles['header']}>
                <div><h2 id={'download-health-title'}>{t('CUSTOM_HEALTH_TITLE', { defaultValue: 'Connection health' })}</h2><p>{t('CUSTOM_HEALTH_DESCRIPTION', { defaultValue: 'Check downloads, storage, providers, and playback in one place.' })}</p></div>
                <span className={styles['version']}>{desktopSettings?.version ? `App ${desktopSettings.version}` : 'Browser client'}</span>
            </div>
            <div className={styles['actions']}>
                <button type={'button'} disabled={!!busy} onClick={() => refresh()}>{t('CUSTOM_HEALTH_REFRESH', { defaultValue: 'Refresh health' })}</button>
                <button type={'button'} disabled={!!busy} onClick={() => refresh(true)} className={styles['primary']}>
                    {busy === 'connections' ? 'Checking connections…' : 'Check connections'}
                </button>
            </div>
            <p className={styles['hint']}>{t('CUSTOM_HEALTH_CHECK_HELP', { defaultValue: 'Connection checks read provider account status and local services. They do not add torrents or start playback. A reachable provider does not guarantee every source is fast or cached.' })}</p>
            <p className={styles['hint']}>{t('CUSTOM_HEALTH_SPEED_HELP', { defaultValue: 'Transfers share your connection. Pause other downloads when comparing the speed of a new source.' })}</p>
            {error ? <p className={styles['error']} role={'alert'}>{error}</p> : null}
            {busy ? <p className={styles['hint']} role={'status'}>{busy === 'connections' ? 'Checking configured providers and local services…' : 'Working…'}</p> : null}
            {report ? <>
                <div className={styles['checks']}>
                    {report.checks.map((item) => <div className={styles['check']} key={item.id}>
                        <div><strong>{item.label}</strong><span>{item.detail}</span></div>
                        <small className={styles[item.state]}>{STATE_LABELS[item.state] || 'Unknown'}</small>
                    </div>)}
                    <div className={styles['check']}>
                        <div><strong>{t('CUSTOM_HEALTH_CORE', { defaultValue: 'Stremio browsing engine' })}</strong><span>{coreReady ? 'The Core worker responded. Individual addon streams depend on their own services.' : 'The Core worker did not respond. Restart the app to recover browsing.'}</span></div>
                        <small className={styles[coreReady ? 'ok' : 'warning']}>{coreReady ? 'Ready' : 'Check'}</small>
                    </div>
                    <div className={styles['check']}>
                        <div><strong>{t('CUSTOM_HEALTH_ACCOUNT_SYNC', { defaultValue: 'Account playback sync' })}</strong><span>{report.syncEnabled ?
                            sync.message || (sync.lastSyncedAt ? `Last synced ${new Date(sync.lastSyncedAt).toLocaleString()}` : 'Enabled; waiting for verified local playback and a signed-in account.') :
                            'Enable account sync in MPC-HC progress settings below.'}</span></div>
                        <small className={styles[sync.state === 'synced' && report.syncEnabled ? 'ok' : 'unverified']}>{report.syncEnabled ? sync.state : 'Off'}</small>
                    </div>
                </div>
                <p className={styles['hint']}>{t('CUSTOM_HEALTH_REFRESHED', { defaultValue: 'Health refreshed' })} {new Date(report.checkedAt).toLocaleTimeString()}{report.checkedConnectionsAt ? ` · Connections checked ${new Date(report.checkedConnectionsAt).toLocaleTimeString()}` : ' · External connections have not been checked yet.'}</p>
                {issue ? <div className={styles['issue']}><strong>{t('CUSTOM_HEALTH_LAST_ISSUE', { defaultValue: 'Last rejected download' })}</strong><p>{getDownloadActionError({ responseBody: { errorCode: issue.code } }, `The request was rejected (HTTP ${issue.status}). Retry to see the specific source message.`)}</p><small>{new Date(issue.time).toLocaleString()} · {issue.code}</small></div> : null}
            </> : null}
            <div className={styles['recovery']}>
                <h3>{t('CUSTOM_HEALTH_RECOVERY', { defaultValue: 'Recovery controls' })}</h3>
                <p>{t('CUSTOM_HEALTH_RESTART_HELP', { defaultValue: 'Restarting pauses active transfers and keeps partial files. Resume them from Downloads afterward.' })}</p>
                <div className={styles['actions']}>
                    <button type={'button'} disabled={!!busy || !desktop?.restartService} onClick={() => runAction('restart', () => desktop.restartService())}>{t('CUSTOM_HEALTH_RESTART_SERVICE', { defaultValue: 'Restart service…' })}</button>
                    <button type={'button'} disabled={!!busy || !desktop?.restartApp} onClick={() => runAction('restart', () => desktop.restartApp())}>{t('CUSTOM_HEALTH_RESTART_APP', { defaultValue: 'Restart app…' })}</button>
                    <button type={'button'} disabled={!!busy || !desktop?.openDiagnostics} onClick={() => runAction('logs', () => desktop.openDiagnostics())}>{t('CUSTOM_HEALTH_OPEN_LOGS', { defaultValue: 'Open diagnostics' })}</button>
                </div>
                {!desktop ? <p className={styles['hint']}>{t('CUSTOM_HEALTH_DESKTOP_ONLY', { defaultValue: 'Service and app restart controls are available in the Windows app.' })}</p> : null}
                <div className={styles['actions']}>
                    <button type={'button'} disabled={!!busy} onClick={() => setConfirmation('options')}>{t('CUSTOM_HEALTH_RESET_OPTIONS', { defaultValue: 'Reset download options…' })}</button>
                    <button type={'button'} disabled={!!busy} onClick={() => setConfirmation('selection')}>{t('CUSTOM_HEALTH_RESET_SELECTION', { defaultValue: 'Clear episode selection…' })}</button>
                </div>
                <p className={styles['hint']}>{t('CUSTOM_HEALTH_RESET_HELP', { defaultValue: 'These resets keep download records, files, account login, provider connections, and player settings.' })}</p>
                {notice ? <p role={'status'}>{notice}</p> : null}
            </div>
            {desktopSettings ? <div className={styles['close-setting']}>
                <h3>{t('CUSTOM_HEALTH_CLOSE_BEHAVIOR', { defaultValue: 'When I close the window' })}</h3>
                <SelectMenu label={'Behavior'} className={styles['close-choice']} value={desktopSettings.closeBehavior} disabled={!!busy} onSelect={(value) => {
                    runAction('preferences', async () => {
                        const next = await desktop.setCloseBehavior(value);
                        if (mounted.current) setDesktopSettings((current) => ({ ...current, ...next }));
                    });
                }} options={[
                    { value: 'tray', label: 'Keep downloads running in the tray' },
                    { value: 'quit', label: 'Pause downloads and quit the app' }
                ]} />
                <p className={styles['hint']}>{t('CUSTOM_HEALTH_TRAY_HELP', { defaultValue: 'Tray mode keeps one app and service running. Reopening brings that same window back. Use App → Quit or Ctrl+Q to exit completely.' })}</p>
            </div> : null}
            {confirmation ? <ModalDialog title={confirmation === 'options' ? 'Reset download options?' : 'Clear saved episode selection?'} onCloseRequest={() => setConfirmation(null)} buttons={[
                { label: 'Cancel', props: { role: 'button', onClick: () => setConfirmation(null) } },
                { label: confirmation === 'options' ? 'Reset options' : 'Clear selection', props: { role: 'button', onClick: reset } }
            ]}><p>{confirmation === 'options' ? 'Restore simultaneous downloads to 2. Active transfers finish normally; queued work follows this limit.' : 'Clear the saved multi-episode selection draft. Downloads already queued or transferring are kept.'}</p></ModalDialog> : null}
        </section>
    );
};
DownloadHealthPanel.propTypes = { onSettingsChange: PropTypes.func.isRequired };
module.exports = DownloadHealthPanel;

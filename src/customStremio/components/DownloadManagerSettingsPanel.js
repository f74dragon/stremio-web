const React = require('react');
const { useTranslation } = require('react-i18next');
const { Button } = require('stremio/components');
const { getBackendSettings, updateBackendSettings } = require('../localBackendClient');
const styles = require('./DownloadManagerSettingsPanel.less');

const PRIMARY_CONCURRENCY_OPTIONS = [1, 2, 3, 4];
const UNLIMITED_CONCURRENT_DOWNLOADS = 'unlimited';

const DownloadManagerSettingsPanel = () => {
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
    );
};

module.exports = DownloadManagerSettingsPanel;

// Copyright (C) 2017-2026 Smart code 203358507

const React = require('react');
const { useTranslation } = require('react-i18next');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { Button, MainNavBars } = require('stremio/components');
const useDownloadRecords = require('stremio/customStremio/useDownloadRecords');
const { groupDownloadRecords, groupDownloadRecordsByMedia } = require('stremio/customStremio/downloadRecordPresentation');
const DownloadMediaGroup = require('stremio/customStremio/components/DownloadMediaGroup');
const DownloadMediaDetails = require('stremio/customStremio/components/DownloadMediaDetails');
const DownloadActivityPanel = require('stremio/customStremio/components/DownloadActivityPanel');
const DownloadManagerSettingsPanel = require('stremio/customStremio/components/DownloadManagerSettingsPanel');
const styles = require('./styles.less');

const Downloads = () => {
    const { t } = useTranslation();
    const contentRef = React.useRef(null);
    const libraryScrollPositionRef = React.useRef(0);
    const [selectedMediaKey, setSelectedMediaKey] = React.useState(null);
    const [settingsOpen, setSettingsOpen] = React.useState(false);
    const {
        items,
        initialLoading,
        refreshing,
        error,
        actionStates,
        actionErrors,
        refresh,
        moveInQueue,
        pause,
        resume,
        cancel,
        retry,
        play,
        openLocation,
        remove,
        removeMedia
    } = useDownloadRecords();
    const groups = React.useMemo(() => groupDownloadRecords(items), [items]);
    const mediaGroups = React.useMemo(() => groupDownloadRecordsByMedia(items), [items]);
    const selectedMediaGroup = React.useMemo(() => {
        return selectedMediaKey ? mediaGroups.find((group) => group.key === selectedMediaKey) || null : null;
    }, [mediaGroups, selectedMediaKey]);
    const hasItems = items.length > 0;
    const updateScrollPosition = React.useCallback((scrollTop) => {
        const applyScrollPosition = () => {
            if (contentRef.current) {
                contentRef.current.scrollTop = scrollTop;
            }
        };

        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(applyScrollPosition);
        } else {
            applyScrollPosition();
        }
    }, []);
    const handleOpenMedia = React.useCallback((mediaKey) => {
        libraryScrollPositionRef.current = contentRef.current?.scrollTop || 0;
        setSelectedMediaKey(mediaKey);
        updateScrollPosition(0);
    }, [updateScrollPosition]);
    const handleBackToLibrary = React.useCallback(() => {
        setSelectedMediaKey(null);
        updateScrollPosition(libraryScrollPositionRef.current);
    }, [updateScrollPosition]);

    React.useEffect(() => {
        if (selectedMediaKey && !selectedMediaGroup && !initialLoading) {
            handleBackToLibrary();
        }
    }, [handleBackToLibrary, initialLoading, selectedMediaGroup, selectedMediaKey]);

    return (
        <MainNavBars className={styles['downloads-container']} route={'downloads'}>
            <main className={styles['downloads-content']} ref={contentRef}>
                {
                    selectedMediaGroup ?
                        <React.Fragment>
                            <DownloadActivityPanel
                                records={items}
                                actionStates={actionStates}
                                actionErrors={actionErrors}
                                onReorder={moveInQueue}
                                onPause={pause}
                                onResume={resume}
                                onCancel={cancel}
                            />
                            <DownloadMediaDetails
                                group={selectedMediaGroup}
                                refreshing={refreshing}
                                error={error}
                                actionStates={actionStates}
                                actionErrors={actionErrors}
                                onBack={handleBackToLibrary}
                                onPause={pause}
                                onResume={resume}
                                onCancel={cancel}
                                onRetry={retry}
                                onPlay={play}
                                onOpenLocation={openLocation}
                                onRemove={remove}
                                onDeleteMedia={removeMedia}
                            />
                        </React.Fragment>
                        :
                        <React.Fragment>
                            <header className={styles['page-header']}>
                                <div className={styles['heading-group']}>
                                    <div className={styles['eyebrow']}>
                                        {t('CUSTOM_DOWNLOADS_LOCAL_LIBRARY', { defaultValue: 'On this device' })}
                                    </div>
                                    <h1 className={styles['page-title']}>
                                        {t('CUSTOM_DOWNLOADS_PAGE_TITLE', { defaultValue: 'Downloads' })}
                                    </h1>
                                </div>
                                <div className={styles['header-actions']}>
                                    {refreshing ? <span className={styles['refreshing-label']}>{t('CUSTOM_DOWNLOADS_REFRESHING', { defaultValue: 'Refreshing...' })}</span> : null}
                                    <Button
                                        className={settingsOpen ? styles['options-button-active'] : styles['options-button']}
                                        aria-expanded={settingsOpen}
                                        onClick={() => setSettingsOpen((current) => !current)}
                                    >
                                        {t('CUSTOM_DOWNLOADS_OPTIONS', { defaultValue: 'Download options' })}
                                    </Button>
                                    <Button
                                        className={styles['refresh-button']}
                                        title={t('CUSTOM_DOWNLOADS_REFRESH_TITLE', { defaultValue: 'Refresh downloads' })}
                                        aria-disabled={refreshing}
                                        disabled={refreshing}
                                        onClick={() => refresh()}
                                    >
                                        {t('CUSTOM_DOWNLOADS_REFRESH', { defaultValue: 'Refresh' })}
                                    </Button>
                                </div>
                            </header>

                            {settingsOpen ? <DownloadManagerSettingsPanel /> : null}

                            <DownloadActivityPanel
                                records={items}
                                actionStates={actionStates}
                                actionErrors={actionErrors}
                                onReorder={moveInQueue}
                                onPause={pause}
                                onResume={resume}
                                onCancel={cancel}
                            />

                            {
                                groups.attention.length > 0 ?
                                    <div className={styles['status-strip']} aria-label={t('CUSTOM_DOWNLOADS_SUMMARY', { defaultValue: 'Download activity' })}>
                                        <div className={styles['status-item-attention']}>
                                            <Icon name={'warning'} />
                                            <strong>{groups.attention.length}</strong>
                                            <span>{t('CUSTOM_DOWNLOADS_FILES_NEED_ATTENTION', { defaultValue: groups.attention.length === 1 ? 'record needs attention' : 'records need attention' })}</span>
                                        </div>
                                    </div>
                                    :
                                    null
                            }

                            {hasItems && error ? <div className={styles['offline-banner']} role={'status'}>{error}</div> : null}

                            {
                                initialLoading && !hasItems ?
                                    <div className={styles['page-state']} aria-live={'polite'}>
                                        <div className={styles['state-icon']}><Icon name={'download'} /></div>
                                        <div className={styles['state-title']}>{t('CUSTOM_DOWNLOADS_LOADING', { defaultValue: 'Loading downloads...' })}</div>
                                    </div>
                                    :
                                    error && !hasItems ?
                                        <div className={styles['page-state']} role={'alert'}>
                                            <div className={styles['state-icon-error']}><Icon name={'warning'} /></div>
                                            <div className={styles['state-title']}>{t('CUSTOM_DOWNLOADS_OFFLINE', { defaultValue: 'Download backend unavailable' })}</div>
                                            <div className={styles['state-description']}>{error}</div>
                                            <Button className={styles['retry-button']} onClick={() => refresh()}>
                                                {t('CUSTOM_DOWNLOADS_RETRY', { defaultValue: 'Try again' })}
                                            </Button>
                                        </div>
                                        :
                                        !hasItems ?
                                            <div className={styles['page-state']}>
                                                <div className={styles['state-icon']}><Icon name={'download'} /></div>
                                                <div className={styles['state-title']}>{t('CUSTOM_DOWNLOADS_EMPTY_TITLE', { defaultValue: 'Your downloads will appear here' })}</div>
                                                <div className={styles['state-description']}>
                                                    {t('CUSTOM_DOWNLOADS_EMPTY_DESCRIPTION', { defaultValue: 'Choose Download from any available stream to add it to this device.' })}
                                                </div>
                                            </div>
                                            :
                                            <div className={styles['sections-container']}>
                                                <section className={styles['download-section']}>
                                                    <div className={styles['section-header']}>
                                                        <div>
                                                            <h2 className={styles['section-title']}>{t('CUSTOM_DOWNLOADS_LIBRARY_TITLE', { defaultValue: 'Your downloaded titles' })}</h2>
                                                            <p className={styles['section-description']}>
                                                                {t('CUSTOM_DOWNLOADS_LIBRARY_DESCRIPTION', { defaultValue: 'Select a movie or show to see its downloads and available actions.' })}
                                                            </p>
                                                        </div>
                                                        <div className={styles['section-count']}>{mediaGroups.length}</div>
                                                    </div>
                                                    <div className={styles['media-grid']}>
                                                        {mediaGroups.map((group) => (
                                                            <DownloadMediaGroup
                                                                key={group.key}
                                                                group={group}
                                                                actionStates={actionStates}
                                                                actionErrors={actionErrors}
                                                                onPlay={play}
                                                                onOpen={handleOpenMedia}
                                                            />
                                                        ))}
                                                    </div>
                                                </section>
                                            </div>
                            }
                        </React.Fragment>
                }
            </main>
        </MainNavBars>
    );
};

module.exports = Downloads;

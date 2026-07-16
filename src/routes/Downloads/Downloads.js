// Copyright (C) 2017-2026 Smart code 203358507

const React = require('react');
const { useTranslation } = require('react-i18next');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { Button, MainNavBars } = require('stremio/components');
const useDownloadRecords = require('stremio/customStremio/useDownloadRecords');
const { groupDownloadRecords } = require('stremio/customStremio/downloadRecordPresentation');
const DownloadRecordCard = require('stremio/customStremio/components/DownloadRecordCard');
const styles = require('./styles.less');

const Downloads = () => {
    const { t } = useTranslation();
    const {
        items,
        initialLoading,
        refreshing,
        error,
        actionStates,
        actionErrors,
        refresh,
        cancel,
        play,
        remove
    } = useDownloadRecords();
    const groups = React.useMemo(() => groupDownloadRecords(items), [items]);
    const hasItems = items.length > 0;
    const sections = [
        {
            id: 'active',
            title: t('CUSTOM_DOWNLOADS_ACTIVE', { defaultValue: 'Active' }),
            description: t('CUSTOM_DOWNLOADS_ACTIVE_DESCRIPTION', { defaultValue: 'Downloads currently queued or in progress.' }),
            items: groups.active
        },
        {
            id: 'completed',
            title: t('CUSTOM_DOWNLOADS_COMPLETED', { defaultValue: 'Ready to play' }),
            description: t('CUSTOM_DOWNLOADS_COMPLETED_DESCRIPTION', { defaultValue: 'Completed files available on this device.' }),
            items: groups.completed
        },
        {
            id: 'attention',
            title: t('CUSTOM_DOWNLOADS_ATTENTION', { defaultValue: 'Needs attention' }),
            description: t('CUSTOM_DOWNLOADS_ATTENTION_DESCRIPTION', { defaultValue: 'Failed or canceled records you may want to review.' }),
            items: groups.attention
        }
    ];

    return (
        <MainNavBars className={styles['downloads-container']} route={'downloads'}>
            <main className={styles['downloads-content']}>
                <header className={styles['page-header']}>
                    <div className={styles['heading-group']}>
                        <div className={styles['eyebrow']}>
                            {t('CUSTOM_DOWNLOADS_LOCAL_LIBRARY', { defaultValue: 'On this device' })}
                        </div>
                        <h1 className={styles['page-title']}>
                            {t('CUSTOM_DOWNLOADS_PAGE_TITLE', { defaultValue: 'Downloads' })}
                        </h1>
                        <p className={styles['page-description']}>
                            {t('CUSTOM_DOWNLOADS_PAGE_DESCRIPTION', {
                                defaultValue: 'Manage downloaded movies and episodes, monitor active transfers, and open completed files.'
                            })}
                        </p>
                    </div>
                    <div className={styles['header-actions']}>
                        {refreshing ? <span className={styles['refreshing-label']}>{t('CUSTOM_DOWNLOADS_REFRESHING', { defaultValue: 'Refreshing...' })}</span> : null}
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

                {
                    hasItems ?
                        <div className={styles['summary-grid']} aria-label={t('CUSTOM_DOWNLOADS_SUMMARY', { defaultValue: 'Download summary' })}>
                            <div className={styles['summary-card']}>
                                <span className={styles['summary-value']}>{items.length}</span>
                                <span className={styles['summary-label']}>{t('CUSTOM_DOWNLOADS_ALL', { defaultValue: 'All records' })}</span>
                            </div>
                            <div className={styles['summary-card']}>
                                <span className={styles['summary-value']}>{groups.active.length}</span>
                                <span className={styles['summary-label']}>{t('CUSTOM_DOWNLOADS_ACTIVE', { defaultValue: 'Active' })}</span>
                            </div>
                            <div className={styles['summary-card']}>
                                <span className={styles['summary-value']}>{groups.completed.length}</span>
                                <span className={styles['summary-label']}>{t('CUSTOM_DOWNLOADS_READY', { defaultValue: 'Ready' })}</span>
                            </div>
                            <div className={styles['summary-card']}>
                                <span className={styles['summary-value']}>{groups.attention.length}</span>
                                <span className={styles['summary-label']}>{t('CUSTOM_DOWNLOADS_ATTENTION', { defaultValue: 'Needs attention' })}</span>
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
                                    {sections.map((section) => section.items.length > 0 ?
                                        <section className={styles['download-section']} key={section.id}>
                                            <div className={styles['section-header']}>
                                                <div>
                                                    <h2 className={styles['section-title']}>{section.title}</h2>
                                                    <p className={styles['section-description']}>{section.description}</p>
                                                </div>
                                                <div className={styles['section-count']}>{section.items.length}</div>
                                            </div>
                                            <div className={styles['records-grid']}>
                                                {section.items.map((record) => (
                                                    <DownloadRecordCard
                                                        key={record.id || `${record.videoId}-${record.createdAt}`}
                                                        record={record}
                                                        variant={'library'}
                                                        action={record.id ? actionStates[record.id] : null}
                                                        actionError={record.id ? actionErrors[record.id] : null}
                                                        onCancel={cancel}
                                                        onPlay={play}
                                                        onRemove={remove}
                                                    />
                                                ))}
                                            </div>
                                        </section>
                                        :
                                        null)}
                                </div>
                }
            </main>
        </MainNavBars>
    );
};

module.exports = Downloads;

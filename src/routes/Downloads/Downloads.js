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
const { getSelectableDownloadIds, getSelectionState } = require('stremio/customStremio/downloadBatchDeletion');
const styles = require('./styles.less');

const Downloads = () => {
    const { t } = useTranslation();
    const contentRef = React.useRef(null);
    const libraryScrollPositionRef = React.useRef(0);
    const [selectedMediaKey, setSelectedMediaKey] = React.useState(null);
    const [settingsOpen, setSettingsOpen] = React.useState(false);
    const [selectionMode, setSelectionMode] = React.useState(false);
    const [selectedRecordIds, setSelectedRecordIds] = React.useState(() => new Set());
    const [confirmingBatchDelete, setConfirmingBatchDelete] = React.useState(false);
    const [batchSelectionSummary, setBatchSelectionSummary] = React.useState(null);
    const [batchDeleting, setBatchDeleting] = React.useState(false);
    const [batchProgress, setBatchProgress] = React.useState(null);
    const [batchFeedback, setBatchFeedback] = React.useState(null);
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
        removeMedia,
        removeMediaBatch
    } = useDownloadRecords();
    const groups = React.useMemo(() => groupDownloadRecords(items), [items]);
    const mediaGroups = React.useMemo(() => groupDownloadRecordsByMedia(items), [items]);
    const selectedMediaGroup = React.useMemo(() => {
        return selectedMediaKey ? mediaGroups.find((group) => group.key === selectedMediaKey) || null : null;
    }, [mediaGroups, selectedMediaKey]);
    const hasItems = items.length > 0;
    const selectableRecordIds = React.useMemo(() => getSelectableDownloadIds(items), [items]);
    const selectedRecords = React.useMemo(() => items.filter((record) => record?.id && selectedRecordIds.has(String(record.id))), [items, selectedRecordIds]);
    const selectedTitleCount = React.useMemo(() => mediaGroups.filter((group) => group.records.some((record) => record?.id && selectedRecordIds.has(String(record.id)))).length, [mediaGroups, selectedRecordIds]);
    const activeExcludedCount = items.length - selectableRecordIds.length;
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
    const handleStartSelection = React.useCallback(() => {
        setBatchFeedback(null);
        setSettingsOpen(false);
        setSelectionMode(true);
    }, []);
    const handleCancelSelection = React.useCallback(() => {
        if (batchDeleting) {
            return;
        }
        setSelectionMode(false);
        setSelectedRecordIds(new Set());
        setConfirmingBatchDelete(false);
        setBatchSelectionSummary(null);
        setBatchProgress(null);
    }, [batchDeleting]);
    const handleToggleRecords = React.useCallback((recordIds) => {
        const selectable = new Set(selectableRecordIds);
        const requestedIds = Array.from(new Set((recordIds || []).map(String))).filter((id) => selectable.has(id));
        if (requestedIds.length === 0) {
            return;
        }
        setSelectedRecordIds((current) => {
            const next = new Set(current);
            const removeRequested = requestedIds.every((id) => next.has(id));
            requestedIds.forEach((id) => removeRequested ? next.delete(id) : next.add(id));
            return next;
        });
        setBatchFeedback(null);
    }, [selectableRecordIds]);
    const handleToggleMediaGroup = React.useCallback((mediaKey) => {
        const group = mediaGroups.find((candidate) => candidate.key === mediaKey);
        handleToggleRecords(getSelectableDownloadIds(group?.records));
    }, [handleToggleRecords, mediaGroups]);
    const handleToggleAll = React.useCallback(() => {
        handleToggleRecords(selectableRecordIds);
    }, [handleToggleRecords, selectableRecordIds]);
    const handleConfirmBatchDelete = React.useCallback(async () => {
        const recordIds = Array.from(selectedRecordIds);
        if (recordIds.length === 0 || batchDeleting) {
            return;
        }

        setBatchDeleting(true);
        setBatchFeedback(null);
        setBatchProgress({ completed: 0, total: recordIds.length });
        try {
            const result = await removeMediaBatch(recordIds, {
                onProgress: ({ completed, total }) => setBatchProgress({ completed, total })
            });
            const failedIds = new Set(result.failures.map(({ id }) => id));
            setSelectedRecordIds(failedIds);
            setConfirmingBatchDelete(false);
            setBatchSelectionSummary(null);
            setBatchFeedback({
                deletedCount: result.successes.length,
                failures: result.failures
            });
            if (result.failures.length === 0) {
                setSelectionMode(false);
            }
        } catch (batchError) {
            setConfirmingBatchDelete(false);
            setBatchSelectionSummary(null);
            setBatchFeedback({
                deletedCount: 0,
                failures: [{
                    error: batchError?.backendError || batchError?.message || 'The batch could not be completed safely.'
                }]
            });
        } finally {
            setBatchDeleting(false);
            setBatchProgress(null);
        }
    }, [batchDeleting, removeMediaBatch, selectedRecordIds]);

    React.useEffect(() => {
        if (selectedMediaKey && !selectedMediaGroup && !initialLoading) {
            handleBackToLibrary();
        }
    }, [handleBackToLibrary, initialLoading, selectedMediaGroup, selectedMediaKey]);

    React.useEffect(() => {
        const existingSelectableIds = new Set(selectableRecordIds);
        setSelectedRecordIds((current) => {
            const next = new Set(Array.from(current).filter((id) => existingSelectableIds.has(id)));
            return next.size === current.size ? current : next;
        });
    }, [selectableRecordIds]);

    return (
        <MainNavBars className={styles['downloads-container']} route={'downloads'}>
            <main className={styles['downloads-content']} ref={contentRef}>
                {
                    batchFeedback ?
                        <div className={batchFeedback.failures.length > 0 ? styles['batch-feedback-error'] : styles['batch-feedback-success']} role={'status'}>
                            <strong>
                                {t('CUSTOM_DOWNLOADS_BATCH_DELETED_COUNT', {
                                    defaultValue: '{{count}} downloads deleted',
                                    count: batchFeedback.deletedCount
                                })}
                            </strong>
                            {
                                batchFeedback.failures.length > 0 ?
                                    <span>
                                        {t('CUSTOM_DOWNLOADS_BATCH_FAILED_COUNT', {
                                            defaultValue: '{{count}} could not be deleted and remain selected. Review the affected records and try again.',
                                            count: batchFeedback.failures.length
                                        })}
                                        {batchFeedback.failures[0]?.error ? ` ${batchFeedback.failures[0].error}` : ''}
                                    </span>
                                    : null
                            }
                            <button type={'button'} onClick={() => setBatchFeedback(null)} aria-label={t('CUSTOM_DOWNLOADS_DISMISS', { defaultValue: 'Dismiss' })}>
                                {t('CUSTOM_DOWNLOADS_CLOSE_SYMBOL', { defaultValue: '\u00d7' })}
                            </button>
                        </div>
                        : null
                }
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
                                selectionMode={selectionMode}
                                selectedRecordIds={selectedRecordIds}
                                onStartSelection={handleStartSelection}
                                onCancelSelection={handleCancelSelection}
                                onToggleRecords={handleToggleRecords}
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
                                    {
                                        selectionMode ?
                                            <React.Fragment>
                                                <span className={styles['selected-count-label']}>
                                                    {t('CUSTOM_DOWNLOADS_SELECTED_COUNT', { defaultValue: '{{count}} selected', count: selectedRecordIds.size })}
                                                </span>
                                                <Button className={styles['select-all-button']} disabled={selectableRecordIds.length === 0} onClick={handleToggleAll}>
                                                    {selectedRecordIds.size === selectableRecordIds.length && selectableRecordIds.length > 0 ?
                                                        t('CUSTOM_DOWNLOADS_CLEAR_ALL', { defaultValue: 'Clear all' })
                                                        : t('CUSTOM_DOWNLOADS_SELECT_ALL', { defaultValue: 'Select all' })}
                                                </Button>
                                                <Button className={styles['cancel-selection-button']} onClick={handleCancelSelection}>
                                                    {t('CUSTOM_DOWNLOADS_CANCEL_SELECTION', { defaultValue: 'Cancel' })}
                                                </Button>
                                            </React.Fragment>
                                            :
                                            <React.Fragment>
                                                {hasItems ? <Button className={styles['select-button']} onClick={handleStartSelection}>{t('CUSTOM_DOWNLOADS_SELECT', { defaultValue: 'Select' })}</Button> : null}
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
                                            </React.Fragment>
                                    }
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
                                                        {mediaGroups.map((group) => {
                                                            const selection = getSelectionState(group.records, selectedRecordIds);
                                                            return (
                                                                <DownloadMediaGroup
                                                                    key={group.key}
                                                                    group={group}
                                                                    actionStates={actionStates}
                                                                    actionErrors={actionErrors}
                                                                    onPlay={play}
                                                                    onOpen={handleOpenMedia}
                                                                    selectionMode={selectionMode}
                                                                    selected={selection.allSelected}
                                                                    partiallySelected={selection.partiallySelected}
                                                                    selectionDisabled={selection.selectableCount === 0}
                                                                    selectableCount={selection.selectableCount}
                                                                    selectedCount={selection.selectedCount}
                                                                    onToggleSelection={handleToggleMediaGroup}
                                                                />
                                                            );
                                                        })}
                                                    </div>
                                                </section>
                                            </div>
                            }
                        </React.Fragment>
                }
                {
                    selectionMode ?
                        <div className={styles['selection-action-bar']} role={'status'}>
                            <div>
                                <strong>{t('CUSTOM_DOWNLOADS_SELECTED_COUNT', { defaultValue: '{{count}} selected', count: selectedRecordIds.size })}</strong>
                                <span>
                                    {activeExcludedCount > 0 ?
                                        t('CUSTOM_DOWNLOADS_ACTIVE_EXCLUDED', {
                                            defaultValue: '{{count}} active downloads excluded; pause or cancel them first.',
                                            count: activeExcludedCount
                                        })
                                        : t('CUSTOM_DOWNLOADS_SELECTION_READY', { defaultValue: 'Only selected local files and their records will be removed.' })}
                                </span>
                            </div>
                            <Button
                                className={styles['delete-selected-button']}
                                disabled={selectedRecordIds.size === 0 || batchDeleting}
                                onClick={() => {
                                    setBatchSelectionSummary({ records: selectedRecords.length, titles: selectedTitleCount });
                                    setConfirmingBatchDelete(true);
                                }}
                            >
                                {t('CUSTOM_DOWNLOADS_DELETE_SELECTED', { defaultValue: 'Delete selected' })}
                            </Button>
                        </div>
                        : null
                }
                {
                    confirmingBatchDelete ?
                        <div className={styles['batch-dialog-backdrop']}>
                            <div className={styles['batch-dialog']} role={'alertdialog'} aria-modal={'true'} aria-labelledby={'bulk-delete-title'}>
                                <div className={styles['batch-dialog-icon']}><Icon name={'warning'} /></div>
                                <h2 id={'bulk-delete-title'}>{t('CUSTOM_DOWNLOADS_DELETE_SELECTED_CONFIRM_TITLE', { defaultValue: 'Delete selected downloads?' })}</h2>
                                <p>
                                    {(batchSelectionSummary?.titles || selectedTitleCount) === 1 ?
                                        t('CUSTOM_DOWNLOADS_DELETE_SELECTED_CONFIRM_BODY_SINGLE_TITLE', {
                                            defaultValue: '{{records}} local downloads from 1 title will be permanently deleted. This cannot be undone.',
                                            records: batchSelectionSummary?.records || selectedRecords.length
                                        })
                                        : t('CUSTOM_DOWNLOADS_DELETE_SELECTED_CONFIRM_BODY', {
                                            defaultValue: '{{records}} local downloads across {{titles}} titles will be permanently deleted. This cannot be undone.',
                                            records: batchSelectionSummary?.records || selectedRecords.length,
                                            titles: batchSelectionSummary?.titles || selectedTitleCount
                                        })}
                                </p>
                                <div className={styles['batch-dialog-summary']}>
                                    <span>{t('CUSTOM_DOWNLOADS_FILES_LABEL', { defaultValue: 'Downloads' })}<strong>{batchSelectionSummary?.records || selectedRecords.length}</strong></span>
                                    <span>{t('CUSTOM_DOWNLOADS_TITLES_LABEL', { defaultValue: 'Titles' })}<strong>{batchSelectionSummary?.titles || selectedTitleCount}</strong></span>
                                </div>
                                {batchProgress ? <div className={styles['batch-progress']}>{t('CUSTOM_DOWNLOADS_DELETING_PROGRESS', { defaultValue: 'Deleting {{completed}} of {{total}}...', completed: batchProgress.completed, total: batchProgress.total })}</div> : null}
                                <div className={styles['batch-dialog-actions']}>
                                    <Button disabled={batchDeleting} onClick={() => {
                                        setConfirmingBatchDelete(false);
                                        setBatchSelectionSummary(null);
                                    }}>{t('CUSTOM_DOWNLOADS_KEEP_DOWNLOADS', { defaultValue: 'Keep downloads' })}</Button>
                                    <Button className={styles['confirm-batch-delete-button']} disabled={batchDeleting} onClick={handleConfirmBatchDelete}>
                                        {batchDeleting ? t('CUSTOM_DOWNLOADS_DELETING', { defaultValue: 'Deleting...' }) : t('CUSTOM_DOWNLOADS_DELETE_COUNT', { defaultValue: 'Delete {{count}}', count: batchSelectionSummary?.records || selectedRecords.length })}
                                    </Button>
                                </div>
                            </div>
                        </div>
                        : null
                }
            </main>
        </MainNavBars>
    );
};

module.exports = Downloads;

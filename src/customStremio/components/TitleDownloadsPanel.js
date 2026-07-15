const React = require('react');
const PropTypes = require('prop-types');
const { useTranslation } = require('react-i18next');
const { Button } = require('stremio/components');
const styles = require('./TitleDownloadsPanel.less');

const CANCELABLE_STATUSES = new Set(['queued', 'downloading', 'paused']);
const REMOVABLE_STATUSES = new Set(['completed', 'failed', 'canceled']);

const formatProgress = (value) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? `${Math.round(numericValue)}%` : '0%';
};

const formatCreatedAt = (value) => {
    if (!value) {
        return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const getRecordTitle = (record, untitledLabel) => {
    if (record?.videoTitle) {
        if (typeof record.season === 'number' && typeof record.episode === 'number') {
            return `S${record.season}E${record.episode} ${record.videoTitle}`;
        }

        return record.videoTitle;
    }

    return untitledLabel;
};

const getStatusClassName = (status) => {
    return [styles['record-status'], styles[`record-status-${status}`]].filter(Boolean).join(' ');
};

const TitleDownloadsPanel = ({
    metaId,
    items = [],
    initialLoading = false,
    refreshing = false,
    error = '',
    actionStates = {},
    actionErrors = {},
    onRefresh,
    onCancel,
    onRemove
}) => {
    const { t } = useTranslation();

    if (!metaId) {
        return null;
    }

    const hasItems = items.length > 0;
    const showInitialLoading = initialLoading && !hasItems;
    const showInitialError = !hasItems && error;
    const showInlineError = hasItems && error;

    return (
        <div className={styles['panel-container']}>
            <div className={styles['panel-header']}>
                <div className={styles['panel-title-row']}>
                    <div className={styles['panel-title']}>
                        {t('CUSTOM_DOWNLOADS_TITLE', { defaultValue: 'Downloads for this title' })}
                    </div>
                    {
                        refreshing ?
                            <div className={styles['panel-refreshing']}>
                                {t('CUSTOM_DOWNLOADS_REFRESHING', { defaultValue: 'Refreshing...' })}
                            </div>
                            :
                            null
                    }
                </div>
                <Button
                    className={styles['refresh-button']}
                    title={t('CUSTOM_DOWNLOADS_REFRESH_TITLE', { defaultValue: 'Refresh downloads' })}
                    onClick={onRefresh}
                >
                    {t('CUSTOM_DOWNLOADS_REFRESH', { defaultValue: 'Refresh' })}
                </Button>
            </div>
            {
                showInitialLoading ?
                    <div className={styles['panel-state']}>
                        {t('CUSTOM_DOWNLOADS_LOADING', { defaultValue: 'Loading downloads...' })}
                    </div>
                    :
                    showInitialError ?
                        <div className={styles['panel-error']}>{error}</div>
                        :
                        !hasItems ?
                            <div className={styles['panel-state']}>
                                {t('CUSTOM_DOWNLOADS_EMPTY', { defaultValue: 'No downloads for this title yet.' })}
                            </div>
                            :
                            <div className={styles['records-container']}>
                                {
                                    showInlineError ?
                                        <div className={styles['panel-error-inline']}>{error}</div>
                                        :
                                        null
                                }
                                {items.map((record) => {
                                    const recordId = record?.id;
                                    const recordTitle = getRecordTitle(record, t('CUSTOM_DOWNLOAD_UNTITLED', { defaultValue: 'Untitled download' }));
                                    const status = record?.status || 'unknown';
                                    const action = recordId ? actionStates[recordId] : null;
                                    const actionError = recordId ? actionErrors[recordId] : null;
                                    const actionInProgress = typeof action === 'string';
                                    const canCancel = recordId && CANCELABLE_STATUSES.has(status);
                                    const canRemove = recordId && REMOVABLE_STATUSES.has(status);

                                    return (
                                        <div
                                            key={recordId || `${record.videoId}-${record.createdAt}`}
                                            className={styles['record-card']}
                                            aria-busy={actionInProgress}
                                        >
                                            <div className={styles['record-heading']}>
                                                <div className={styles['record-title']}>{recordTitle}</div>
                                                <div className={getStatusClassName(status)}>{status}</div>
                                            </div>
                                            <div className={styles['record-meta']}>
                                                <span>{record.addonName || t('CUSTOM_DOWNLOAD_UNKNOWN_ADDON', { defaultValue: 'Unknown addon' })}</span>
                                                <span>{record.streamName || t('CUSTOM_DOWNLOAD_UNKNOWN_STREAM', { defaultValue: 'Unknown stream' })}</span>
                                                <span>
                                                    {t('CUSTOM_DOWNLOAD_PROGRESS', {
                                                        defaultValue: 'Progress: {{progress}}',
                                                        progress: formatProgress(record.progress)
                                                    })}
                                                </span>
                                            </div>
                                            {
                                                record.localPath ?
                                                    <div className={styles['record-path']} title={record.localPath}>
                                                        {record.localPath}
                                                    </div>
                                                    :
                                                    null
                                            }
                                            {
                                                record.createdAt ?
                                                    <div className={styles['record-created']}>
                                                        {t('CUSTOM_DOWNLOAD_CREATED', {
                                                            defaultValue: 'Created: {{createdAt}}',
                                                            createdAt: formatCreatedAt(record.createdAt)
                                                        })}
                                                    </div>
                                                    :
                                                    null
                                            }
                                            {
                                                actionError ?
                                                    <div className={styles['record-action-error']} role={'alert'}>{actionError}</div>
                                                    :
                                                    null
                                            }
                                            {
                                                canCancel || canRemove ?
                                                    <div className={styles['record-actions']}>
                                                        {
                                                            canRemove ?
                                                                <div className={styles['record-action-note']}>
                                                                    {t('CUSTOM_DOWNLOAD_REMOVE_NOTE', { defaultValue: 'The downloaded file will stay on disk.' })}
                                                                </div>
                                                                :
                                                                null
                                                        }
                                                        {
                                                            canCancel ?
                                                                <Button
                                                                    className={styles['cancel-button']}
                                                                    title={t('CUSTOM_DOWNLOAD_CANCEL_TITLE', {
                                                                        defaultValue: 'Cancel {{title}}',
                                                                        title: recordTitle
                                                                    })}
                                                                    role={'button'}
                                                                    aria-label={t('CUSTOM_DOWNLOAD_CANCEL_TITLE', {
                                                                        defaultValue: 'Cancel {{title}}',
                                                                        title: recordTitle
                                                                    })}
                                                                    aria-disabled={actionInProgress}
                                                                    disabled={actionInProgress}
                                                                    tabIndex={actionInProgress ? -1 : 0}
                                                                    onClick={() => !actionInProgress && onCancel?.(recordId)}
                                                                >
                                                                    {action === 'cancel' ?
                                                                        t('CUSTOM_DOWNLOAD_CANCELING', { defaultValue: 'Canceling...' })
                                                                        :
                                                                        t('CUSTOM_DOWNLOAD_CANCEL', { defaultValue: 'Cancel' })}
                                                                </Button>
                                                                :
                                                                null
                                                        }
                                                        {
                                                            canRemove ?
                                                                <Button
                                                                    className={styles['remove-button']}
                                                                    title={t('CUSTOM_DOWNLOAD_REMOVE_TITLE', {
                                                                        defaultValue: 'Remove {{title}} from this list; the downloaded file will stay on disk',
                                                                        title: recordTitle
                                                                    })}
                                                                    role={'button'}
                                                                    aria-label={t('CUSTOM_DOWNLOAD_REMOVE_ARIA_LABEL', {
                                                                        defaultValue: 'Remove {{title}} record; keep the downloaded file',
                                                                        title: recordTitle
                                                                    })}
                                                                    aria-disabled={actionInProgress}
                                                                    disabled={actionInProgress}
                                                                    tabIndex={actionInProgress ? -1 : 0}
                                                                    onClick={() => !actionInProgress && onRemove?.(recordId)}
                                                                >
                                                                    {action === 'remove' ?
                                                                        t('CUSTOM_DOWNLOAD_REMOVING', { defaultValue: 'Removing...' })
                                                                        :
                                                                        t('CUSTOM_DOWNLOAD_REMOVE', { defaultValue: 'Remove record' })}
                                                                </Button>
                                                                :
                                                                null
                                                        }
                                                    </div>
                                                    :
                                                    null
                                            }
                                        </div>
                                    );
                                })}
                            </div>
            }
        </div>
    );
};

TitleDownloadsPanel.propTypes = {
    metaId: PropTypes.string,
    items: PropTypes.arrayOf(PropTypes.object),
    initialLoading: PropTypes.bool,
    refreshing: PropTypes.bool,
    error: PropTypes.string,
    actionStates: PropTypes.objectOf(PropTypes.oneOf(['cancel', 'remove'])),
    actionErrors: PropTypes.objectOf(PropTypes.string),
    onRefresh: PropTypes.func,
    onCancel: PropTypes.func,
    onRemove: PropTypes.func
};

module.exports = TitleDownloadsPanel;

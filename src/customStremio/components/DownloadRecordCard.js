const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useTranslation } = require('react-i18next');
const { Button } = require('stremio/components');
const { getDownloadDetailsHref, getQueuePosition } = require('../downloadRecordPresentation');
const styles = require('./DownloadRecordCard.less');

const CANCELABLE_STATUSES = new Set(['queued', 'downloading', 'paused']);
const PAUSABLE_STATUSES = new Set(['queued', 'downloading']);
const REMOVABLE_STATUSES = new Set(['completed', 'failed', 'canceled']);
const RETRYABLE_STATUSES = new Set(['failed', 'canceled']);
const MEDIA_DELETABLE_STATUSES = new Set(['paused', 'completed', 'failed', 'canceled']);

const formatProgress = (value) => {
    const numericValue = Number(value);
    const progress = Number.isFinite(numericValue) ? Math.min(100, Math.max(0, numericValue)) : 0;
    return {
        label: `${Math.round(progress)}%`,
        value: progress
    };
};

const formatCreatedAt = (value) => {
    if (!value) {
        return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const formatBytes = (value) => {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) {
        return null;
    }

    if (bytes < 1024) {
        return `${Math.round(bytes)} B`;
    }

    const units = ['KB', 'MB', 'GB', 'TB'];
    let amount = bytes / 1024;
    let unitIndex = 0;
    while (amount >= 1024 && unitIndex < units.length - 1) {
        amount /= 1024;
        unitIndex += 1;
    }

    return `${amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${units[unitIndex]}`;
};

const getEpisodeLabel = (record) => {
    if (typeof record?.season !== 'number' || typeof record?.episode !== 'number') {
        return record?.videoTitle || null;
    }

    return `S${record.season}E${record.episode}${record.videoTitle ? ` ${record.videoTitle}` : ''}`;
};

const getRecordLabels = (record, variant, untitledLabel) => {
    if (variant === 'library') {
        const title = record?.type === 'series' ?
            getEpisodeLabel(record)
            :
            record?.videoTitle || record?.parentTitle || record?.streamName;
        return { title: title || untitledLabel, subtitle: null };
    }

    return {
        title: getEpisodeLabel(record) || untitledLabel,
        subtitle: null
    };
};

const getQueueLabels = (record, t) => {
    if (record?.status !== 'queued') {
        return { status: record?.status || 'unknown', detail: null };
    }

    const position = getQueuePosition(record);
    const queueLength = Number(record?.queueLength);
    if (position === 1) {
        return {
            status: t('CUSTOM_DOWNLOADS_NEXT_IN_QUEUE', { defaultValue: 'Next in queue' }),
            detail: Number.isSafeInteger(queueLength) && queueLength > 0 ?
                t('CUSTOM_DOWNLOADS_QUEUE_POSITION_DETAIL', {
                    defaultValue: 'Queue position {{position}} of {{count}}',
                    position,
                    count: queueLength
                })
                :
                t('CUSTOM_DOWNLOADS_WAITING_FOR_SLOT', { defaultValue: 'Waiting for an available download slot' })
        };
    }
    if (position !== null) {
        return {
            status: t('CUSTOM_DOWNLOADS_QUEUED_POSITION', { defaultValue: 'Queued #{{position}}', position }),
            detail: Number.isSafeInteger(queueLength) && queueLength >= position ?
                t('CUSTOM_DOWNLOADS_QUEUE_POSITION_DETAIL', {
                    defaultValue: 'Queue position {{position}} of {{count}}',
                    position,
                    count: queueLength
                })
                :
                t('CUSTOM_DOWNLOADS_QUEUE_POSITION', { defaultValue: 'Queue position #{{position}}', position })
        };
    }

    return {
        status: t('CUSTOM_DOWNLOADS_STARTING', { defaultValue: 'Starting...' }),
        detail: t('CUSTOM_DOWNLOADS_WAITING_FOR_SCHEDULER', { defaultValue: 'Waiting for the download scheduler' })
    };
};

const DownloadRecordCard = ({
    record,
    variant = 'compact',
    action,
    actionError,
    onPause,
    onResume,
    onCancel,
    onRetry,
    onPlay,
    onOpenLocation,
    onRemove,
    onDeleteMedia,
    selectionMode = false
}) => {
    const { t } = useTranslation();
    const recordId = record?.id;
    const [confirmingMediaDelete, setConfirmingMediaDelete] = React.useState(false);
    const status = record?.status || 'unknown';
    const labels = getRecordLabels(record, variant, t('CUSTOM_DOWNLOAD_UNTITLED', { defaultValue: 'Untitled download' }));
    const detailsHref = variant === 'library' ? getDownloadDetailsHref(record) : null;
    const progress = formatProgress(record?.progress);
    const fileSize = formatBytes(record?.bytesTotal ?? record?.bytesDownloaded);
    const queueLabels = getQueueLabels(record, t);
    const actionInProgress = typeof action === 'string';
    const canCancel = recordId && CANCELABLE_STATUSES.has(status);
    const canPause = recordId && PAUSABLE_STATUSES.has(status);
    const canResume = recordId && status === 'paused';
    const canPlay = recordId && status === 'completed';
    const canOpenLocation = recordId && variant === 'library' && Boolean(record?.localPath);
    const hasSharedPartialOwner = Number(record?.sharedPartialOwnerCount) > 0;
    const canRemove = recordId && REMOVABLE_STATUSES.has(status) &&
        (status === 'completed' || !record?.partialPath || hasSharedPartialOwner);
    const canRetry = recordId && RETRYABLE_STATUSES.has(status);
    const canDeleteMedia = recordId && MEDIA_DELETABLE_STATUSES.has(status) && typeof onDeleteMedia === 'function';
    const isPartialMedia = status !== 'completed';
    const localDataSize = formatBytes(isPartialMedia ? record?.bytesDownloaded : record?.bytesTotal ?? record?.bytesDownloaded);
    const playTitle = t('CUSTOM_DOWNLOAD_PLAY_TITLE', {
        defaultValue: 'Play {{title}} in MPC-HC',
        title: labels.title
    });

    React.useEffect(() => {
        setConfirmingMediaDelete(false);
    }, [recordId, selectionMode]);

    return (
        <article
            className={classnames(styles['record-card'], styles[`record-card-${variant}`])}
            aria-busy={actionInProgress}
        >
            <div className={styles['record-heading']}>
                <div className={styles['record-title-group']}>
                    {
                        detailsHref ?
                            <Button className={styles['record-title-link']} href={detailsHref} title={labels.title}>
                                {labels.title}
                            </Button>
                            :
                            <div className={styles['record-title']}>{labels.title}</div>
                    }
                    {labels.subtitle ? <div className={styles['record-subtitle']}>{labels.subtitle}</div> : null}
                </div>
                <div className={classnames(styles['record-status'], styles[`record-status-${status}`])}>{queueLabels.status}</div>
            </div>
            {
                variant === 'library' ?
                    <div className={styles['record-essential-meta']}>
                        {queueLabels.detail ? <span className={styles['queue-meta']}>{queueLabels.detail}</span> : null}
                        <span>{fileSize || t('CUSTOM_DOWNLOAD_SIZE_UNKNOWN', { defaultValue: 'Size unavailable' })}</span>
                        <span>{progress.label}</span>
                    </div>
                    :
                    <div className={styles['record-meta']}>
                        {queueLabels.detail ? <span className={styles['queue-meta']}>{queueLabels.detail}</span> : null}
                        <span>{record?.addonName || t('CUSTOM_DOWNLOAD_UNKNOWN_ADDON', { defaultValue: 'Unknown addon' })}</span>
                        <span>{record?.streamName || t('CUSTOM_DOWNLOAD_UNKNOWN_STREAM', { defaultValue: 'Unknown stream' })}</span>
                        <span>
                            {t('CUSTOM_DOWNLOAD_PROGRESS', {
                                defaultValue: 'Progress: {{progress}}',
                                progress: progress.label
                            })}
                        </span>
                    </div>
            }
            <div className={styles['progress-track']} aria-hidden={'true'}>
                <div className={styles['progress-value']} style={{ width: `${progress.value}%` }} />
            </div>
            {record?.error ? <div className={styles['record-error']}>{record.error}</div> : null}
            {
                variant === 'library' ?
                    <details className={styles['download-info']}>
                        <summary>{t('CUSTOM_DOWNLOAD_INFO', { defaultValue: 'Download info' })}</summary>
                        <div className={styles['download-info-content']}>
                            <div><span>{t('CUSTOM_DOWNLOAD_ADDON_LABEL', { defaultValue: 'Addon' })}</span><strong>{record?.addonName || t('CUSTOM_DOWNLOAD_UNKNOWN_ADDON', { defaultValue: 'Unknown addon' })}</strong></div>
                            <div><span>{t('CUSTOM_DOWNLOAD_STREAM_LABEL', { defaultValue: 'Stream' })}</span><strong>{record?.streamName || t('CUSTOM_DOWNLOAD_UNKNOWN_STREAM', { defaultValue: 'Unknown stream' })}</strong></div>
                            {queueLabels.detail ? <div><span>{t('CUSTOM_DOWNLOAD_QUEUE_LABEL', { defaultValue: 'Queue' })}</span><strong>{queueLabels.detail}</strong></div> : null}
                            {record?.createdAt ? <div><span>{t('CUSTOM_DOWNLOAD_CREATED_LABEL', { defaultValue: 'Added' })}</span><strong>{formatCreatedAt(record.createdAt)}</strong></div> : null}
                            {record?.localPath ? <div className={styles['record-path']} title={record.localPath}><span>{t('CUSTOM_DOWNLOAD_PATH_LABEL', { defaultValue: 'File' })}</span><strong>{record.localPath}</strong></div> : null}
                        </div>
                    </details>
                    :
                    <React.Fragment>
                        {record?.localPath ? <div className={styles['record-path']} title={record.localPath}>{record.localPath}</div> : null}
                        {
                            record?.createdAt ?
                                <div className={styles['record-created']}>
                                    {t('CUSTOM_DOWNLOAD_CREATED', {
                                        defaultValue: 'Created: {{createdAt}}',
                                        createdAt: formatCreatedAt(record.createdAt)
                                    })}
                                </div>
                                :
                                null
                        }
                    </React.Fragment>
            }
            {actionError ? <div className={styles['record-action-error']} role={'alert'}>{actionError}</div> : null}
            {
                !selectionMode && confirmingMediaDelete && canDeleteMedia ?
                    <div className={styles['delete-confirmation']} role={'alertdialog'} aria-label={t('CUSTOM_DOWNLOAD_DELETE_CONFIRM_TITLE', { defaultValue: 'Confirm local download deletion' })}>
                        <strong>
                            {isPartialMedia ?
                                t('CUSTOM_DOWNLOAD_DELETE_PARTIAL_CONFIRM_TITLE', { defaultValue: 'Delete partial download data?' })
                                : t('CUSTOM_DOWNLOAD_DELETE_FILE_CONFIRM_TITLE', { defaultValue: 'Delete downloaded file?' })}
                        </strong>
                        <span>
                            {isPartialMedia ?
                                t('CUSTOM_DOWNLOAD_DELETE_PARTIAL_CONFIRM_BODY', {
                                    defaultValue: '{{size}} of partial data and this record will be permanently removed. It cannot be resumed.',
                                    size: localDataSize || t('CUSTOM_DOWNLOAD_SIZE_UNKNOWN', { defaultValue: 'Any saved' })
                                })
                                : t('CUSTOM_DOWNLOAD_DELETE_FILE_CONFIRM_BODY', {
                                    defaultValue: 'The {{size}} local media file and this record will be permanently removed.',
                                    size: localDataSize || t('CUSTOM_DOWNLOAD_FILE', { defaultValue: 'downloaded' })
                                })}
                        </span>
                        <div className={styles['delete-confirmation-actions']}>
                            <Button
                                className={styles['keep-button']}
                                disabled={actionInProgress}
                                onClick={() => !actionInProgress && setConfirmingMediaDelete(false)}
                            >
                                {t('CUSTOM_DOWNLOAD_KEEP', { defaultValue: 'Keep download' })}
                            </Button>
                            <Button
                                className={styles['confirm-delete-button']}
                                disabled={actionInProgress}
                                onClick={() => !actionInProgress && onDeleteMedia(recordId)}
                            >
                                {action === 'deleteMedia' ?
                                    t('CUSTOM_DOWNLOAD_DELETING', { defaultValue: 'Deleting...' })
                                    : isPartialMedia ?
                                        t('CUSTOM_DOWNLOAD_DELETE_PARTIAL', { defaultValue: 'Delete partial data' })
                                        : t('CUSTOM_DOWNLOAD_DELETE_FILE', { defaultValue: 'Delete file' })}
                            </Button>
                        </div>
                    </div>
                    : null
            }
            {
                !selectionMode && (canPause || canResume || canCancel || canRetry || canPlay || canOpenLocation || canRemove || canDeleteMedia) ?
                    <div className={styles['record-actions']}>
                        {
                            canOpenLocation ?
                                <Button
                                    className={styles['location-button']}
                                    title={t('CUSTOM_DOWNLOAD_OPEN_LOCATION_TITLE', {
                                        defaultValue: 'Open the location of {{title}} in File Explorer',
                                        title: labels.title
                                    })}
                                    aria-disabled={actionInProgress}
                                    disabled={actionInProgress}
                                    tabIndex={actionInProgress ? -1 : 0}
                                    onClick={() => !actionInProgress && onOpenLocation?.(recordId)}
                                >
                                    {action === 'location' ?
                                        t('CUSTOM_DOWNLOAD_OPENING_LOCATION', { defaultValue: 'Opening folder...' })
                                        :
                                        t('CUSTOM_DOWNLOAD_OPEN_LOCATION', { defaultValue: 'Open location' })}
                                </Button>
                                :
                                null
                        }
                        {
                            canPause ?
                                <Button
                                    className={styles['pause-button']}
                                    title={t('CUSTOM_DOWNLOAD_PAUSE_TITLE', { defaultValue: 'Pause {{title}}', title: labels.title })}
                                    aria-disabled={actionInProgress}
                                    disabled={actionInProgress}
                                    tabIndex={actionInProgress ? -1 : 0}
                                    onClick={() => !actionInProgress && onPause?.(recordId)}
                                >
                                    {action === 'pause' ?
                                        t('CUSTOM_DOWNLOAD_PAUSING', { defaultValue: 'Pausing...' })
                                        :
                                        t('CUSTOM_DOWNLOAD_PAUSE', { defaultValue: 'Pause' })}
                                </Button>
                                :
                                null
                        }
                        {
                            canResume ?
                                <Button
                                    className={styles['resume-button']}
                                    title={t('CUSTOM_DOWNLOAD_RESUME_TITLE', { defaultValue: 'Resume {{title}}', title: labels.title })}
                                    aria-disabled={actionInProgress}
                                    disabled={actionInProgress}
                                    tabIndex={actionInProgress ? -1 : 0}
                                    onClick={() => !actionInProgress && onResume?.(recordId)}
                                >
                                    {action === 'resume' ?
                                        t('CUSTOM_DOWNLOAD_RESUMING', { defaultValue: 'Resuming...' })
                                        :
                                        t('CUSTOM_DOWNLOAD_RESUME', { defaultValue: 'Resume' })}
                                </Button>
                                :
                                null
                        }
                        {
                            canRetry ?
                                <Button
                                    className={styles['retry-download-button']}
                                    title={t('CUSTOM_DOWNLOAD_RETRY_TITLE', {
                                        defaultValue: 'Retry {{title}} from the beginning',
                                        title: labels.title
                                    })}
                                    aria-disabled={actionInProgress}
                                    disabled={actionInProgress}
                                    tabIndex={actionInProgress ? -1 : 0}
                                    onClick={() => !actionInProgress && onRetry?.(recordId)}
                                >
                                    {action === 'retry' ?
                                        t('CUSTOM_DOWNLOAD_RETRYING', { defaultValue: 'Retrying...' })
                                        :
                                        t('CUSTOM_DOWNLOAD_RETRY', { defaultValue: 'Retry' })}
                                </Button>
                                :
                                null
                        }
                        {
                            canRemove ?
                                <div className={styles['record-action-note']}>
                                    {record?.partialPath && hasSharedPartialOwner ?
                                        t('CUSTOM_DOWNLOAD_REMOVE_SHARED_NOTE', {
                                            defaultValue: 'Remove this duplicate record first. Its shared partial file stays protected for the remaining record.'
                                        })
                                        :
                                        t('CUSTOM_DOWNLOAD_REMOVE_NOTE', { defaultValue: 'Remove record keeps any downloaded or partial file data on disk.' })}
                                </div>
                                :
                                null
                        }
                        {
                            canPlay ?
                                <Button
                                    className={styles['play-button']}
                                    title={playTitle}
                                    aria-label={playTitle}
                                    aria-disabled={actionInProgress}
                                    disabled={actionInProgress}
                                    tabIndex={actionInProgress ? -1 : 0}
                                    onClick={() => !actionInProgress && onPlay?.(recordId)}
                                >
                                    {action === 'play' ?
                                        t('CUSTOM_DOWNLOAD_OPENING', { defaultValue: 'Opening...' })
                                        :
                                        t('CUSTOM_DOWNLOAD_PLAY', { defaultValue: 'Play' })}
                                </Button>
                                :
                                null
                        }
                        {
                            canCancel ?
                                <Button
                                    className={styles['cancel-button']}
                                    title={t('CUSTOM_DOWNLOAD_CANCEL_TITLE', {
                                        defaultValue: 'Cancel {{title}}',
                                        title: labels.title
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
                                        defaultValue: 'Remove {{title}} from this list; any local file data will stay on disk',
                                        title: labels.title
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
                        {
                            canDeleteMedia ?
                                <Button
                                    className={styles['delete-media-button']}
                                    title={isPartialMedia ?
                                        t('CUSTOM_DOWNLOAD_DELETE_PARTIAL_TITLE', { defaultValue: 'Permanently delete partial data for {{title}}', title: labels.title })
                                        : t('CUSTOM_DOWNLOAD_DELETE_FILE_TITLE', { defaultValue: 'Permanently delete {{title}} from disk', title: labels.title })}
                                    aria-disabled={actionInProgress}
                                    disabled={actionInProgress}
                                    tabIndex={actionInProgress ? -1 : 0}
                                    onClick={() => !actionInProgress && setConfirmingMediaDelete(true)}
                                >
                                    {action === 'deleteMedia' ?
                                        t('CUSTOM_DOWNLOAD_DELETING', { defaultValue: 'Deleting...' })
                                        : isPartialMedia ?
                                            t('CUSTOM_DOWNLOAD_DELETE_PARTIAL', { defaultValue: 'Delete partial data' })
                                            : t('CUSTOM_DOWNLOAD_DELETE_DOWNLOAD', { defaultValue: 'Delete download' })}
                                </Button>
                                : null
                        }
                    </div>
                    :
                    null
            }
        </article>
    );
};

DownloadRecordCard.propTypes = {
    record: PropTypes.object.isRequired,
    variant: PropTypes.oneOf(['compact', 'library']),
    action: PropTypes.oneOf(['queue', 'pause', 'resume', 'cancel', 'retry', 'play', 'location', 'remove', 'deleteMedia']),
    actionError: PropTypes.string,
    onPause: PropTypes.func,
    onResume: PropTypes.func,
    onCancel: PropTypes.func,
    onRetry: PropTypes.func,
    onPlay: PropTypes.func,
    onOpenLocation: PropTypes.func,
    onRemove: PropTypes.func,
    onDeleteMedia: PropTypes.func,
    selectionMode: PropTypes.bool
};

module.exports = DownloadRecordCard;

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useTranslation } = require('react-i18next');
const { Button } = require('stremio/components');
const { getDownloadDetailsHref } = require('../downloadRecordPresentation');
const styles = require('./DownloadRecordCard.less');

const CANCELABLE_STATUSES = new Set(['queued', 'downloading', 'paused']);
const REMOVABLE_STATUSES = new Set(['completed', 'failed', 'canceled']);

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

const getEpisodeLabel = (record) => {
    if (typeof record?.season !== 'number' || typeof record?.episode !== 'number') {
        return record?.videoTitle || null;
    }

    return `S${record.season}E${record.episode}${record.videoTitle ? ` ${record.videoTitle}` : ''}`;
};

const getRecordLabels = (record, variant, untitledLabel) => {
    if (variant === 'library') {
        const title = record?.parentTitle || record?.videoTitle || record?.streamName || untitledLabel;
        const subtitle = record?.type === 'series' ? getEpisodeLabel(record) : null;
        return { title, subtitle: subtitle !== title ? subtitle : null };
    }

    return {
        title: getEpisodeLabel(record) || untitledLabel,
        subtitle: null
    };
};

const DownloadRecordCard = ({
    record,
    variant = 'compact',
    action,
    actionError,
    onCancel,
    onPlay,
    onRemove
}) => {
    const { t } = useTranslation();
    const recordId = record?.id;
    const status = record?.status || 'unknown';
    const labels = getRecordLabels(record, variant, t('CUSTOM_DOWNLOAD_UNTITLED', { defaultValue: 'Untitled download' }));
    const detailsHref = variant === 'library' ? getDownloadDetailsHref(record) : null;
    const progress = formatProgress(record?.progress);
    const actionInProgress = typeof action === 'string';
    const canCancel = recordId && CANCELABLE_STATUSES.has(status);
    const canPlay = recordId && status === 'completed';
    const canRemove = recordId && REMOVABLE_STATUSES.has(status);
    const playTitle = t('CUSTOM_DOWNLOAD_PLAY_TITLE', {
        defaultValue: 'Play {{title}} in MPC-HC',
        title: labels.title
    });

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
                <div className={classnames(styles['record-status'], styles[`record-status-${status}`])}>{status}</div>
            </div>
            <div className={styles['record-meta']}>
                <span>{record?.addonName || t('CUSTOM_DOWNLOAD_UNKNOWN_ADDON', { defaultValue: 'Unknown addon' })}</span>
                <span>{record?.streamName || t('CUSTOM_DOWNLOAD_UNKNOWN_STREAM', { defaultValue: 'Unknown stream' })}</span>
                <span>
                    {t('CUSTOM_DOWNLOAD_PROGRESS', {
                        defaultValue: 'Progress: {{progress}}',
                        progress: progress.label
                    })}
                </span>
            </div>
            <div className={styles['progress-track']} aria-hidden={'true'}>
                <div className={styles['progress-value']} style={{ width: `${progress.value}%` }} />
            </div>
            {record?.error ? <div className={styles['record-error']}>{record.error}</div> : null}
            {
                record?.localPath ?
                    <div className={styles['record-path']} title={record.localPath}>{record.localPath}</div>
                    :
                    null
            }
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
            {actionError ? <div className={styles['record-action-error']} role={'alert'}>{actionError}</div> : null}
            {
                canCancel || canPlay || canRemove ?
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
                                        defaultValue: 'Remove {{title}} from this list; the downloaded file will stay on disk',
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
    action: PropTypes.oneOf(['cancel', 'play', 'remove']),
    actionError: PropTypes.string,
    onCancel: PropTypes.func,
    onPlay: PropTypes.func,
    onRemove: PropTypes.func
};

module.exports = DownloadRecordCard;

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useTranslation } = require('react-i18next');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { Button, Image } = require('stremio/components');
const { getDownloadActivitySummary, getQueuePosition } = require('../downloadRecordPresentation');
const styles = require('./DownloadActivityPanel.less');

const formatBytes = (value) => {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) {
        return null;
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let amount = bytes;
    let unitIndex = 0;
    while (amount >= 1024 && unitIndex < units.length - 1) {
        amount /= 1024;
        unitIndex += 1;
    }

    const precision = unitIndex === 0 || amount >= 10 ? 0 : 1;
    return `${amount.toFixed(precision)} ${units[unitIndex]}`;
};

const formatDuration = (value) => {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) {
        return null;
    }

    if (seconds < 60) {
        return '< 1 min';
    }

    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) {
        return `${minutes} min`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`;
};

const getRecordLabels = (record, fallbackTitle) => {
    const title = record?.parentTitle || record?.videoTitle || record?.streamName || fallbackTitle;
    if (record?.type !== 'series') {
        const subtitle = record?.videoTitle && record.videoTitle !== title ? record.videoTitle : null;
        return { title, subtitle };
    }

    const episodeNumber = typeof record?.season === 'number' && typeof record?.episode === 'number' ?
        `S${record.season} E${record.episode}`
        :
        null;
    const episodeTitle = record?.videoTitle && record.videoTitle !== title ? record.videoTitle : null;
    return {
        title,
        subtitle: [episodeNumber, episodeTitle].filter(Boolean).join(' · ') || null
    };
};

const getRecordProgress = (record) => {
    const value = Number(record?.progress);
    return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
};

const getQueueLabel = (record, t) => {
    const position = getQueuePosition(record);
    const queueLength = Number(record?.queueLength);
    if (position === 1) {
        return t('CUSTOM_DOWNLOADS_NEXT_IN_QUEUE', { defaultValue: 'Next in queue' });
    }
    if (position !== null && Number.isSafeInteger(queueLength) && queueLength >= position) {
        return t('CUSTOM_DOWNLOADS_QUEUE_POSITION_OF_TOTAL', {
            defaultValue: '#{{position}} of {{count}} in queue',
            position,
            count: queueLength
        });
    }
    if (position !== null) {
        return t('CUSTOM_DOWNLOADS_QUEUE_POSITION', { defaultValue: 'Queue position #{{position}}', position });
    }
    return t('CUSTOM_DOWNLOADS_STARTING', { defaultValue: 'Starting...' });
};

const DownloadActivityPanel = ({ records, actionStates, actionErrors, onPause, onResume, onCancel }) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = React.useState(false);
    const summary = React.useMemo(() => getDownloadActivitySummary(records), [records]);

    if (summary.count === 0) {
        return null;
    }

    const totalProgress = summary.progress === null ? null : Math.round(summary.progress);
    const transferredLabel = summary.downloadingCount === 0 ? null : (summary.bytesTotal === null ?
        formatBytes(summary.bytesDownloaded)
        :
        `${formatBytes(summary.bytesDownloaded)} / ${formatBytes(summary.bytesTotal)}`);
    const speedLabel = summary.speedBytesPerSecond > 0 ? `${formatBytes(summary.speedBytesPerSecond)}/s` : null;
    const etaLabel = formatDuration(summary.etaSeconds);
    const queuedLabel = summary.queuedCount > 0 ?
        t('CUSTOM_DOWNLOADS_QUEUED_COUNT', {
            defaultValue: summary.queuedCount === 1 ? '{{count}} queued' : '{{count}} queued',
            count: summary.queuedCount
        })
        :
        null;
    const pausedLabel = summary.pausedCount > 0 ?
        t('CUSTOM_DOWNLOADS_PAUSED_COUNT', { defaultValue: '{{count}} paused', count: summary.pausedCount })
        :
        null;
    const summaryMetrics = [transferredLabel, speedLabel, etaLabel ? `${etaLabel} left` : null, queuedLabel, pausedLabel].filter(Boolean);
    const activityLabel = summary.downloadingCount > 0 ?
        t('CUSTOM_DOWNLOADS_TRANSFERRING_ACTIVITY', {
            defaultValue: summary.downloadingCount === 1 ? '{{count}} downloading' : '{{count}} downloading',
            count: summary.downloadingCount
        })
        :
        summary.queuedCount > 0 ?
            t('CUSTOM_DOWNLOADS_QUEUED_ACTIVITY', {
                defaultValue: summary.queuedCount === 1 ? '{{count}} queued download' : '{{count}} queued downloads',
                count: summary.queuedCount
            })
            :
            t('CUSTOM_DOWNLOADS_PAUSED_ACTIVITY', {
                defaultValue: summary.count === 1 ? '{{count}} paused download' : '{{count}} paused downloads',
                count: summary.count
            });
    const progressLabel = summary.downloadingCount > 0 ?
        (totalProgress === null ? t('CUSTOM_DOWNLOADS_PREPARING', { defaultValue: 'Preparing' }) : `${totalProgress}%`)
        :
        summary.queuedCount > 0 ? t('CUSTOM_DOWNLOADS_WAITING', { defaultValue: 'Waiting' }) : t('CUSTOM_DOWNLOADS_PAUSED', { defaultValue: 'Paused' });
    const waitingIndeterminate = summary.downloadingCount === 0 && summary.queuedCount > 0;

    return (
        <section className={styles['activity-panel']} aria-label={activityLabel}>
            <button
                type={'button'}
                className={styles['activity-summary']}
                aria-expanded={expanded}
                onClick={() => setExpanded((current) => !current)}
            >
                <span className={styles['activity-icon']} aria-hidden={'true'}><Icon name={'download'} /></span>
                <span className={styles['activity-copy']}>
                    <strong>{activityLabel}</strong>
                    {summaryMetrics.length > 0 ? <small>{summaryMetrics.join(' · ')}</small> : null}
                </span>
                <span className={styles['activity-progress-label']}>
                    {progressLabel}
                </span>
                <span className={classnames(styles['activity-chevron'], expanded && styles['activity-chevron-expanded'])} aria-hidden={'true'} />
            </button>
            <div className={styles['total-progress-track']} aria-hidden={'true'}>
                <div
                    className={classnames(styles['total-progress-value'], (summary.indeterminate || waitingIndeterminate) && styles['total-progress-value-indeterminate'])}
                    style={summary.indeterminate || waitingIndeterminate ? undefined : { width: `${totalProgress || 0}%` }}
                />
            </div>
            {
                expanded ?
                    <div className={styles['activity-list']}>
                        {summary.records.map((record) => {
                            const labels = getRecordLabels(record, t('CUSTOM_DOWNLOAD_UNTITLED', { defaultValue: 'Untitled download' }));
                            const artwork = record?.videoThumbnail || record?.poster || record?.background || null;
                            const progress = getRecordProgress(record);
                            const recordId = record?.id;
                            const action = recordId ? actionStates[recordId] : null;
                            const actionInProgress = typeof action === 'string';
                            const isPaused = record?.status === 'paused';
                            const isQueued = record?.status === 'queued';
                            const queueLabel = isQueued ? getQueueLabel(record, t) : null;
                            const recordSpeed = Number(record?.speedBytesPerSecond) > 0 ? `${formatBytes(record.speedBytesPerSecond)}/s` : null;
                            const recordEta = formatDuration(record?.etaSeconds);
                            const recordBytes = Number(record?.bytesTotal) > 0 ?
                                `${formatBytes(record.bytesDownloaded || 0)} / ${formatBytes(record.bytesTotal)}`
                                :
                                formatBytes(record?.bytesDownloaded);
                            const waitingLabel = isQueued ? t('CUSTOM_DOWNLOADS_WAITING_FOR_SLOT', { defaultValue: 'Waiting for an available download slot' }) : null;
                            const recordMetrics = [waitingLabel, recordBytes, recordSpeed, recordEta ? `${recordEta} left` : null].filter(Boolean);

                            return (
                                <article className={styles['activity-record']} key={recordId || `${record?.sourceUrl}-${record?.createdAt}`} aria-busy={actionInProgress}>
                                    <div className={styles['record-artwork']}>
                                        {artwork ? <Image src={artwork} alt={' '} /> : <Icon name={'download'} />}
                                    </div>
                                    <div className={styles['record-content']}>
                                        <div className={styles['record-heading']}>
                                            <div className={styles['record-titles']}>
                                                <strong title={labels.title}>{labels.title}</strong>
                                                {labels.subtitle ? <span title={labels.subtitle}>{labels.subtitle}</span> : null}
                                            </div>
                                            <span className={classnames(styles['record-percent'], isQueued && styles['record-percent-queued'])}>
                                                {isQueued ? queueLabel : `${Math.round(progress)}%`}
                                            </span>
                                        </div>
                                        <div className={styles['record-progress-track']} aria-hidden={'true'}>
                                            <div className={styles['record-progress-value']} style={{ width: `${progress}%` }} />
                                        </div>
                                        <div className={styles['record-footer']}>
                                            <span className={styles['record-metrics']}>{recordMetrics.join(' · ')}</span>
                                            <span className={styles['record-actions']}>
                                                <Button
                                                    className={isPaused ? styles['resume-button'] : styles['pause-button']}
                                                    aria-disabled={actionInProgress}
                                                    disabled={actionInProgress}
                                                    onClick={() => !actionInProgress && (isPaused ? onResume?.(recordId) : onPause?.(recordId))}
                                                >
                                                    {isPaused ?
                                                        (action === 'resume' ? t('CUSTOM_DOWNLOAD_RESUMING', { defaultValue: 'Resuming...' }) : t('CUSTOM_DOWNLOAD_RESUME', { defaultValue: 'Resume' }))
                                                        :
                                                        (action === 'pause' ? t('CUSTOM_DOWNLOAD_PAUSING', { defaultValue: 'Pausing...' }) : t('CUSTOM_DOWNLOAD_PAUSE', { defaultValue: 'Pause' }))}
                                                </Button>
                                                <Button
                                                    className={styles['cancel-button']}
                                                    aria-disabled={actionInProgress}
                                                    disabled={actionInProgress}
                                                    onClick={() => !actionInProgress && onCancel?.(recordId)}
                                                >
                                                    {action === 'cancel' ?
                                                        t('CUSTOM_DOWNLOAD_CANCELING', { defaultValue: 'Canceling...' })
                                                        :
                                                        t('CUSTOM_DOWNLOAD_CANCEL', { defaultValue: 'Cancel' })}
                                                </Button>
                                            </span>
                                        </div>
                                        {recordId && actionErrors[recordId] ? <div className={styles['record-error']} role={'alert'}>{actionErrors[recordId]}</div> : null}
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                    :
                    null
            }
        </section>
    );
};

DownloadActivityPanel.propTypes = {
    records: PropTypes.arrayOf(PropTypes.object).isRequired,
    actionStates: PropTypes.object.isRequired,
    actionErrors: PropTypes.object.isRequired,
    onPause: PropTypes.func,
    onResume: PropTypes.func,
    onCancel: PropTypes.func
};

module.exports = DownloadActivityPanel;

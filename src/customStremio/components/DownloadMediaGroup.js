const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useTranslation } = require('react-i18next');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { Image } = require('stremio/components');
const { getDownloadActivitySummary } = require('../downloadRecordPresentation');
const { findMostRecentPlaybackRecord, getPlaybackProgressForRecord } = require('../playbackProgressPresentation');
const styles = require('./DownloadMediaGroup.less');

const getEpisodeResumeLabel = (record, mediaType, t) => {
    if (mediaType !== 'series') {
        return null;
    }

    if (Number.isFinite(record.season) && Number.isFinite(record.episode)) {
        return t('CUSTOM_DOWNLOADS_RESUME_EPISODE', {
            defaultValue: 'S{{season}}E{{episode}}',
            season: record.season,
            episode: record.episode
        });
    }

    return record?.videoTitle || null;
};

const DownloadMediaGroup = ({
    group,
    actionStates,
    actionErrors,
    playbackProgressByDownloadId,
    onPlay,
    onOpen,
    selectionMode = false,
    selected = false,
    partiallySelected = false,
    selectionDisabled = false,
    selectableCount = 0,
    selectedCount = 0,
    onToggleSelection
}) => {
    const { t } = useTranslation();
    const isMovie = group.type === 'movie';
    const playableRecord = findMostRecentPlaybackRecord(group.records, playbackProgressByDownloadId) || group.latestCompletedRecord;
    const playableRecordId = playableRecord?.id;
    const playbackProgress = getPlaybackProgressForRecord(playableRecord, playbackProgressByDownloadId);
    const playAction = playableRecordId ? actionStates[playableRecordId] : null;
    const playActionInProgress = typeof playAction === 'string';
    const playError = playableRecordId ? actionErrors[playableRecordId] : null;
    const groupArtwork = group.poster || group.background || group.records[0]?.videoThumbnail || null;
    const resumeEpisodeLabel = getEpisodeResumeLabel(playableRecord, group.type, t);
    const resumeTimeLabel = playbackProgress?.positionLabel && playbackProgress?.remainingLabel ?
        t('CUSTOM_DOWNLOADS_RESUME_TIME_CONTEXT', {
            defaultValue: '{{elapsed}} elapsed · {{remaining}} left',
            elapsed: playbackProgress.positionLabel,
            remaining: playbackProgress.remainingLabel
        })
        : playbackProgress?.positionLabel ?
            t('CUSTOM_DOWNLOADS_RESUME_ELAPSED', {
                defaultValue: '{{elapsed}} elapsed',
                elapsed: playbackProgress.positionLabel
            })
            : null;
    const activity = React.useMemo(() => getDownloadActivitySummary(group.records), [group.records]);
    const progressValue = activity.progress === null ? 0 : Math.round(activity.progress);
    const episodeCountLabel = t('CUSTOM_DOWNLOADS_EPISODE_COUNT', {
        defaultValue: group.episodeCount === 1 ? '{{count}} downloaded episode' : '{{count}} downloaded episodes',
        count: group.episodeCount
    });
    const playTitle = playbackProgress ?
        t('CUSTOM_DOWNLOAD_CONTINUE_TITLE', { defaultValue: 'Continue {{title}} in MPC-HC', title: group.title })
        : t('CUSTOM_DOWNLOAD_PLAY_TITLE', { defaultValue: 'Play {{title}} in MPC-HC', title: group.title });

    const handlePlay = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (playableRecordId && !playActionInProgress) {
            onPlay?.(playableRecordId);
        }
    };

    return (
        <article className={classnames(styles['media-card'], selected && styles['media-card-selected'])}>
            <div className={classnames(styles['poster-container'], selected && styles['poster-container-selected'])}>
                {
                    groupArtwork ?
                        <Image className={styles['poster']} src={groupArtwork} alt={group.title} />
                        :
                        <div className={styles['poster-fallback']} aria-hidden={'true'}><Icon name={'download'} /></div>
                }
                <div className={styles['poster-shade']} />
                <button
                    type={'button'}
                    className={styles['poster-details-hit-area']}
                    title={selectionMode ?
                        t('CUSTOM_DOWNLOADS_SELECT_TITLE', { defaultValue: 'Select {{title}} for deletion', title: group.title })
                        : t('CUSTOM_DOWNLOADS_OPEN_TITLE', { defaultValue: 'Open downloads for {{title}}', title: group.title })}
                    aria-label={selectionMode ?
                        t('CUSTOM_DOWNLOADS_SELECT_TITLE', { defaultValue: 'Select {{title}} for deletion', title: group.title })
                        : t('CUSTOM_DOWNLOADS_OPEN_TITLE', { defaultValue: 'Open downloads for {{title}}', title: group.title })}
                    aria-pressed={selectionMode ? selected : undefined}
                    disabled={selectionMode && selectionDisabled}
                    onClick={() => selectionMode ? onToggleSelection?.(group.key) : onOpen?.(group.key)}
                />
                {
                    selectionMode ?
                        <span
                            className={classnames(
                                styles['selection-indicator'],
                                selected && styles['selection-indicator-selected'],
                                partiallySelected && styles['selection-indicator-partial'],
                                selectionDisabled && styles['selection-indicator-disabled']
                            )}
                            aria-hidden={'true'}
                        >
                            {selected ? '\u2713' : partiallySelected ? '\u2212' : ''}
                        </span>
                        : null
                }
                {group.attentionCount > 0 ? <span className={classnames(styles['attention-indicator'], selectionMode && styles['attention-indicator-selection'])} title={t('CUSTOM_DOWNLOADS_ATTENTION_SHORT', { defaultValue: 'Needs attention' })}><Icon name={'warning'} /></span> : null}
                {
                    !selectionMode && isMovie ?
                        activity.count > 0 ?
                            <div
                                className={classnames(styles['movie-progress'], activity.indeterminate && styles['movie-progress-indeterminate'])}
                                style={{ '--progress-angle': `${progressValue * 3.6}deg` }}
                                title={activity.indeterminate ?
                                    t('CUSTOM_DOWNLOADS_CALCULATING_PROGRESS', { defaultValue: 'Calculating download progress' })
                                    :
                                    t('CUSTOM_DOWNLOADS_PROGRESS_PERCENT', { defaultValue: '{{progress}}% downloaded', progress: progressValue })}
                            >
                                <span>{activity.indeterminate ? <Icon name={'download'} /> : `${progressValue}%`}</span>
                            </div>
                            :
                            playableRecordId ?
                                <button
                                    type={'button'}
                                    className={styles['movie-play-button']}
                                    title={playTitle}
                                    aria-label={playTitle}
                                    disabled={playActionInProgress}
                                    onClick={handlePlay}
                                >
                                    <Icon name={'play'} />
                                </button>
                                :
                                null
                        : !selectionMode ?
                            <div className={styles['episode-count-badge']} title={episodeCountLabel} aria-label={episodeCountLabel}>
                                <strong>{group.episodeCount}</strong>
                                <span>{t('CUSTOM_DOWNLOADS_EPISODES_SHORT', { defaultValue: 'EP' })}</span>
                            </div>
                            : null
                }
                {
                    !selectionMode && playbackProgress ?
                        <div className={styles['poster-resume']}>
                            <div className={styles['poster-resume-heading']}>
                                <strong>{t('CUSTOM_DOWNLOADS_CONTINUE_WATCHING', { defaultValue: 'Continue watching' })}</strong>
                                <span>{t('CUSTOM_DOWNLOADS_WATCHED_PERCENT', { defaultValue: '{{progress}}% watched', progress: playbackProgress.percent })}</span>
                            </div>
                            {resumeEpisodeLabel ? <div className={styles['poster-resume-episode']} title={playableRecord?.videoTitle || resumeEpisodeLabel}>{resumeEpisodeLabel}{playableRecord?.videoTitle ? ` · ${playableRecord.videoTitle}` : ''}</div> : null}
                            {resumeTimeLabel ? <div className={styles['poster-resume-time']}>{resumeTimeLabel}</div> : null}
                            <div className={styles['poster-resume-track']} aria-hidden={'true'}>
                                <div className={styles['poster-resume-value']} style={{ width: `${playbackProgress.percent}%` }} />
                            </div>
                        </div>
                        : null
                }
            </div>
            <div className={styles['media-info']}>
                <h2 className={styles['media-title']} title={group.title}>{group.title}</h2>
                {
                    selectionMode ?
                        <div className={styles['selection-meta']}>
                            {selectionDisabled ?
                                t('CUSTOM_DOWNLOADS_ACTIVE_NOT_SELECTABLE', { defaultValue: 'Active downloads must be paused or canceled first' })
                                : t('CUSTOM_DOWNLOADS_SELECTED_FILE_COUNT', {
                                    defaultValue: '{{selected}} of {{count}} selected',
                                    selected: selectedCount,
                                    count: selectableCount
                                })}
                        </div>
                        : null
                }
                {playError ? <div className={styles['action-error']} role={'alert'}>{playError}</div> : null}
            </div>
        </article>
    );
};

DownloadMediaGroup.propTypes = {
    group: PropTypes.shape({
        key: PropTypes.string.isRequired,
        title: PropTypes.string.isRequired,
        type: PropTypes.string,
        poster: PropTypes.string,
        background: PropTypes.string,
        records: PropTypes.arrayOf(PropTypes.object).isRequired,
        episodeCount: PropTypes.number.isRequired,
        activeCount: PropTypes.number.isRequired,
        completedCount: PropTypes.number.isRequired,
        attentionCount: PropTypes.number.isRequired,
        latestCompletedRecord: PropTypes.object
    }).isRequired,
    actionStates: PropTypes.object.isRequired,
    actionErrors: PropTypes.object.isRequired,
    playbackProgressByDownloadId: PropTypes.object,
    onPlay: PropTypes.func,
    onOpen: PropTypes.func,
    selectionMode: PropTypes.bool,
    selected: PropTypes.bool,
    partiallySelected: PropTypes.bool,
    selectionDisabled: PropTypes.bool,
    selectableCount: PropTypes.number,
    selectedCount: PropTypes.number,
    onToggleSelection: PropTypes.func
};

module.exports = DownloadMediaGroup;

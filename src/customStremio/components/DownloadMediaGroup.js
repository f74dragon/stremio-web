const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useTranslation } = require('react-i18next');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { Image } = require('stremio/components');
const { getDownloadActivitySummary } = require('../downloadRecordPresentation');
const styles = require('./DownloadMediaGroup.less');

const DownloadMediaGroup = ({
    group,
    actionStates,
    actionErrors,
    onPlay,
    onOpen
}) => {
    const { t } = useTranslation();
    const isMovie = group.type === 'movie';
    const playableRecord = group.latestCompletedRecord;
    const playableRecordId = playableRecord?.id;
    const playAction = playableRecordId ? actionStates[playableRecordId] : null;
    const playActionInProgress = typeof playAction === 'string';
    const playError = playableRecordId ? actionErrors[playableRecordId] : null;
    const groupArtwork = group.poster || group.background || group.records[0]?.videoThumbnail || null;
    const activity = React.useMemo(() => getDownloadActivitySummary(group.records), [group.records]);
    const progressValue = activity.progress === null ? 0 : Math.round(activity.progress);
    const episodeCountLabel = t('CUSTOM_DOWNLOADS_EPISODE_COUNT', {
        defaultValue: group.episodeCount === 1 ? '{{count}} downloaded episode' : '{{count}} downloaded episodes',
        count: group.episodeCount
    });
    const playTitle = t('CUSTOM_DOWNLOAD_PLAY_TITLE', { defaultValue: 'Play {{title}} in MPC-HC', title: group.title });

    const handlePlay = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (playableRecordId && !playActionInProgress) {
            onPlay?.(playableRecordId);
        }
    };

    return (
        <article className={styles['media-card']}>
            <div className={styles['poster-container']}>
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
                    title={t('CUSTOM_DOWNLOADS_OPEN_TITLE', { defaultValue: 'Open downloads for {{title}}', title: group.title })}
                    aria-label={t('CUSTOM_DOWNLOADS_OPEN_TITLE', { defaultValue: 'Open downloads for {{title}}', title: group.title })}
                    onClick={() => onOpen?.(group.key)}
                />
                {group.attentionCount > 0 ? <span className={styles['attention-indicator']} title={t('CUSTOM_DOWNLOADS_ATTENTION_SHORT', { defaultValue: 'Needs attention' })}><Icon name={'warning'} /></span> : null}
                {
                    isMovie ?
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
                        :
                        <div className={styles['episode-count-badge']} title={episodeCountLabel} aria-label={episodeCountLabel}>
                            <strong>{group.episodeCount}</strong>
                            <span>{t('CUSTOM_DOWNLOADS_EPISODES_SHORT', { defaultValue: 'EP' })}</span>
                        </div>
                }
            </div>
            <div className={styles['media-info']}>
                <h2 className={styles['media-title']} title={group.title}>{group.title}</h2>
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
    onPlay: PropTypes.func,
    onOpen: PropTypes.func
};

module.exports = DownloadMediaGroup;

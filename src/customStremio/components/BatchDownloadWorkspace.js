const React = require('react');
const PropTypes = require('prop-types');
const { useTranslation } = require('react-i18next');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { Button, Image } = require('stremio/components');
const { getBatchDownloadAssignments, getBatchSourceQualityLabel } = require('../batchDownloadSelection');
const { DEBRID_PROVIDER } = require('../debridSourceReadiness');
const styles = require('./BatchDownloadWorkspace.less');

const formatSize = (bytes) => {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) {
        return 'Size not supplied by addon';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const amount = value / (1024 ** unitIndex);
    return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
};

const getProviderLabel = (provider) => provider === DEBRID_PROVIDER.ALLDEBRID ? 'AllDebrid' :
    provider === DEBRID_PROVIDER.REALDEBRID ? 'Real-Debrid' : 'Debrid provider';

const getEpisodeLabel = (episode) => Number.isSafeInteger(episode?.season) && Number.isSafeInteger(episode?.episode) ?
    `S${episode.season}E${episode.episode}` : episode?.title || 'Episode';

const getAssignmentQuality = (assignment) => assignment?.qualityLabel || getBatchSourceQualityLabel({
    name: assignment?.sourceName,
    payload: assignment?.payload
});

const BatchDownloadWorkspace = ({
    parentTitle,
    poster,
    session,
    currentEpisode,
    automationStatus,
    queueState,
    onChangeSource,
    onChooseManually,
    onQueue,
    onCancel
}) => {
    const { t } = useTranslation();
    const assignments = React.useMemo(() => getBatchDownloadAssignments(session), [session]);
    const isReview = session?.status === 'review';
    const selectedCount = assignments.length;
    const totalCount = session?.episodes?.length || 0;
    const completion = totalCount > 0 ? Math.round((selectedCount / totalCount) * 100) : 0;
    const totalSize = assignments.reduce((sum, { assignment }) => sum + (Number(assignment.size) || 0), 0);
    const qualitySummary = React.useMemo(() => {
        const counts = new Map();
        assignments.forEach(({ assignment }) => {
            const quality = getAssignmentQuality(assignment);
            counts.set(quality, (counts.get(quality) || 0) + 1);
        });
        return Array.from(counts.entries()).map(([quality, count]) => `${count}× ${quality}`).join(' · ');
    }, [assignments]);
    const groupedAssignments = React.useMemo(() => assignments.reduce((groups, item) => {
        const season = Number.isSafeInteger(item.episode.season) ? item.episode.season : 0;
        const group = groups.find((entry) => entry.season === season);
        if (group) {
            group.items.push(item);
        } else {
            groups.push({ season, items: [item] });
        }
        return groups;
    }, []), [assignments]);
    const stage = automationStatus?.stage || 'preparing';
    const stageCopy = stage === 'checking' ? {
        title: t('CUSTOM_BATCH_VERIFYING_CANDIDATE', { defaultValue: 'Verifying the best candidate' }),
        detail: t('CUSTOM_BATCH_ONE_AT_A_TIME', { defaultValue: 'Only this source is being checked. Lower-ranked sources wait unless it fails.' })
    } : stage === 'selecting' ? {
        title: t('CUSTOM_BATCH_SAFE_SOURCE_FOUND', { defaultValue: 'Safe source found' }),
        detail: t('CUSTOM_BATCH_SAVING_SELECTION', { defaultValue: 'Saving this episode and preparing the next one.' })
    } : stage === 'blocked' ? {
        title: t('CUSTOM_BATCH_NEEDS_CHOICE', { defaultValue: 'This episode needs your choice' }),
        detail: t('CUSTOM_BATCH_NEEDS_CHOICE_HELP', { defaultValue: 'No remaining source can be verified automatically. Review its sources manually to continue.' })
    } : {
        title: t('CUSTOM_BATCH_LOADING_EPISODE_SOURCES', { defaultValue: 'Loading and ranking episode sources' }),
        detail: t('CUSTOM_BATCH_RANKING_HELP', { defaultValue: 'Quality is ranked first, then file size. No provider check starts until ranking is complete.' })
    };
    const sourceFacts = automationStatus?.sourceName ? {
        name: automationStatus.sourceName,
        provider: automationStatus.provider,
        addonName: automationStatus.addonName,
        quality: automationStatus.quality,
        size: automationStatus.size,
        candidateNumber: automationStatus.candidateNumber,
        total: automationStatus.total
    } : null;

    return (
        <div className={styles['workspace-overlay']} role={'dialog'} aria-modal={'true'} aria-label={isReview ?
            t('CUSTOM_BATCH_REVIEW_EPISODE_SOURCES', { defaultValue: 'Review episode sources' })
            : t('CUSTOM_BATCH_AUTOMATIC_SELECTION', { defaultValue: 'Automatic source selection' })}>
            <section className={styles['workspace-card']}>
                <header className={styles['workspace-header']}>
                    {poster ? <Image className={styles['workspace-poster']} src={poster} alt={' '} /> : null}
                    <div className={styles['workspace-heading-copy']}>
                        <span className={styles['workspace-eyebrow']}>{parentTitle || session?.parentTitle}</span>
                        <strong>{isReview ?
                            t('CUSTOM_BATCH_REVIEW_EPISODE_SOURCES', { defaultValue: 'Review episode sources' })
                            : t('CUSTOM_BATCH_FINDING_DOWNLOADS', { defaultValue: 'Finding your best downloads' })}</strong>
                        <span>{isReview ?
                            t('CUSTOM_BATCH_REVIEW_HELP', { defaultValue: 'Confirm the selected source for every episode before adding them to the queue.' })
                            : t('CUSTOM_BATCH_SEQUENTIAL_HELP', { defaultValue: 'Each episode is resolved quietly and checked one source at a time.' })}</span>
                    </div>
                    <div className={styles['workspace-count']}>
                        <strong>{`${selectedCount}/${totalCount}`}</strong>
                        <span>{t('CUSTOM_BATCH_SELECTED', { defaultValue: 'selected' })}</span>
                    </div>
                </header>

                {!isReview ?
                    <React.Fragment>
                        <div className={styles['workspace-progress']} aria-hidden={'true'}>
                            <span style={{ width: `${Math.max(3, completion)}%` }} />
                        </div>
                        <div className={styles['workspace-stage-grid']}>
                            <div className={styles['workspace-stage-complete']}><i>1</i><span><strong>{t('CUSTOM_BATCH_RANK', { defaultValue: 'Rank' })}</strong><small>{t('CUSTOM_BATCH_QUALITY_SIZE', { defaultValue: 'Quality and size' })}</small></span></div>
                            <div className={styles['workspace-stage-active']}><i>2</i><span><strong>{t('CUSTOM_BATCH_VERIFY', { defaultValue: 'Verify' })}</strong><small>{t('CUSTOM_BATCH_ONE_SOURCE', { defaultValue: 'One source at a time' })}</small></span></div>
                            <div><i>3</i><span><strong>{t('CUSTOM_BATCH_REVIEW', { defaultValue: 'Review' })}</strong><small>{t('CUSTOM_BATCH_CONFIRM_QUEUE', { defaultValue: 'Confirm and queue' })}</small></span></div>
                        </div>
                        <div className={styles['workspace-current']} role={'status'} aria-live={'polite'}>
                            <span className={styles['workspace-orbit']} aria-hidden={'true'}><i /></span>
                            <div className={styles['workspace-current-copy']}>
                                <span className={styles['workspace-eyebrow']}>{currentEpisode ? `${getEpisodeLabel(currentEpisode)} · ${currentEpisode.title}` : ''}</span>
                                <strong>{stageCopy.title}</strong>
                                <span>{stageCopy.detail}</span>
                            </div>
                            {stage === 'blocked' ?
                                <Button className={styles['workspace-secondary']} onClick={onChooseManually}>
                                    {t('CUSTOM_BATCH_REVIEW_SOURCES_MANUALLY', { defaultValue: 'Review sources' })}
                                </Button>
                                : null}
                        </div>
                        {sourceFacts ?
                            <div className={styles['workspace-source']} role={'status'} aria-live={'polite'}>
                                <div>
                                    <span className={styles['workspace-eyebrow']}>{t('CUSTOM_BATCH_CURRENT_CANDIDATE', { defaultValue: 'Current candidate' })}</span>
                                    <strong title={sourceFacts.name}>{sourceFacts.name}</strong>
                                    <span>{`${sourceFacts.provider || 'Debrid provider'} · ${sourceFacts.addonName || 'Unknown addon'}`}</span>
                                </div>
                                <div className={styles['workspace-facts']}>
                                    <span>{sourceFacts.quality || 'Quality unavailable'}</span>
                                    <span>{sourceFacts.size || 'Size not supplied by addon'}</span>
                                </div>
                                {sourceFacts.candidateNumber ? <small>{`Candidate ${sourceFacts.candidateNumber} of ${sourceFacts.total}`}</small> : null}
                            </div>
                            : null}
                        <div className={styles['workspace-episode-list']}>
                            {session.episodes.map((episode) => {
                                const assignment = session.assignments?.[episode.id];
                                const isCurrent = currentEpisode?.id === episode.id;
                                return (
                                    <div className={isCurrent ? styles['workspace-episode-current'] : null} key={episode.id}>
                                        <i>{assignment ? <Icon name={'checkmark'} /> : isCurrent ? <span /> : null}</i>
                                        <div>
                                            <strong>{`${getEpisodeLabel(episode)} ${episode.title}`}</strong>
                                            <span>{assignment ?
                                                `${getAssignmentQuality(assignment)} · ${formatSize(assignment.size)}`
                                                : isCurrent ? stageCopy.title : t('CUSTOM_BATCH_WAITING', { defaultValue: 'Waiting' })}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </React.Fragment>
                    :
                    <React.Fragment>
                        <div className={styles['workspace-summary']}>
                            <span><strong>{totalCount}</strong>{t('CUSTOM_BATCH_EPISODES', { defaultValue: ' episodes' })}</span>
                            <span><strong>{formatSize(totalSize)}</strong>{t('CUSTOM_BATCH_TOTAL_SIZE', { defaultValue: ' total' })}</span>
                            {qualitySummary ? <span><strong>{qualitySummary}</strong></span> : null}
                        </div>
                        <div className={styles['workspace-review-list']}>
                            {groupedAssignments.map((group) => (
                                <section className={styles['workspace-season']} key={group.season}>
                                    <strong className={styles['workspace-season-title']}>{group.season > 0 ?
                                        t('CUSTOM_BATCH_SEASON_NUMBER', { defaultValue: 'Season {{season}}', season: group.season })
                                        : t('CUSTOM_BATCH_EPISODES', { defaultValue: 'Episodes' })}</strong>
                                    {group.items.map(({ episode, assignment }) => {
                                        const filename = assignment.payload?.behaviorHints?.filename || assignment.payload?.fileName || assignment.sourceName;
                                        return (
                                            <div className={styles['workspace-review-row']} key={episode.id}>
                                                <div className={styles['workspace-review-episode']}>
                                                    <strong>{getEpisodeLabel(episode)}</strong>
                                                    <span>{episode.title}</span>
                                                </div>
                                                <div className={styles['workspace-review-source']}>
                                                    <strong>{`${getProviderLabel(assignment.provider)} · ${assignment.addonName || 'Unknown addon'}`}</strong>
                                                    <span title={filename}>{filename}</span>
                                                    <div className={styles['workspace-facts']}>
                                                        <span>{getAssignmentQuality(assignment)}</span>
                                                        <span>{formatSize(assignment.size)}</span>
                                                    </div>
                                                </div>
                                                <Button
                                                    className={styles['workspace-change']}
                                                    disabled={queueState?.queueing || assignment.submitted}
                                                    onClick={() => onChangeSource(episode.id)}
                                                >
                                                    {assignment.submitted ?
                                                        t('CUSTOM_BATCH_ALREADY_QUEUED', { defaultValue: 'Queued' })
                                                        : t('CUSTOM_BATCH_CHANGE_SOURCE', { defaultValue: 'Change' })}
                                                </Button>
                                            </div>
                                        );
                                    })}
                                </section>
                            ))}
                        </div>
                        {queueState?.errors?.length ?
                            <div className={styles['workspace-errors']} role={'alert'}>
                                {queueState.errors.map(({ episode, message }) => <span key={episode.id}>{`${getEpisodeLabel(episode)}: ${message}`}</span>)}
                            </div>
                            : null}
                    </React.Fragment>}

                <footer className={styles['workspace-footer']}>
                    <Button className={styles['workspace-secondary']} disabled={queueState?.queueing} onClick={onCancel}>
                        {t('CUSTOM_BATCH_CANCEL', { defaultValue: 'Cancel batch' })}
                    </Button>
                    {isReview ?
                        <Button className={styles['workspace-primary']} disabled={queueState?.queueing || assignments.every(({ assignment }) => assignment.submitted)} onClick={onQueue}>
                            <Icon name={'download'} />
                            <span>{queueState?.queueing ?
                                t('CUSTOM_BATCH_ADDING_PROGRESS', { defaultValue: 'Adding {{completed}}/{{total}}…', completed: queueState.completed, total: queueState.total })
                                : t('CUSTOM_BATCH_QUEUE_EPISODES', { defaultValue: 'Queue {{count}} episodes', count: assignments.filter(({ assignment }) => !assignment.submitted).length })}</span>
                        </Button>
                        : null}
                </footer>
            </section>
        </div>
    );
};

BatchDownloadWorkspace.propTypes = {
    parentTitle: PropTypes.string,
    poster: PropTypes.string,
    session: PropTypes.object.isRequired,
    currentEpisode: PropTypes.object,
    automationStatus: PropTypes.object,
    queueState: PropTypes.object,
    onChangeSource: PropTypes.func.isRequired,
    onChooseManually: PropTypes.func.isRequired,
    onQueue: PropTypes.func.isRequired,
    onCancel: PropTypes.func.isRequired
};

module.exports = BatchDownloadWorkspace;

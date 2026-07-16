const React = require('react');
const PropTypes = require('prop-types');
const { useTranslation } = require('react-i18next');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { Button, Image } = require('stremio/components');
const { groupSeriesRecordsBySeason } = require('../downloadRecordPresentation');
const DownloadRecordCard = require('./DownloadRecordCard');
const styles = require('./DownloadMediaDetails.less');

const getRecordArtwork = (record, group) => {
    return record?.videoThumbnail || record?.background || group?.background || record?.poster || group?.poster || null;
};

const getRecordArtworkLabel = (record, fallback) => {
    if (typeof record?.season === 'number' && typeof record?.episode === 'number') {
        return `S${record.season} E${record.episode}`;
    }

    return record?.videoTitle || fallback;
};

const getMetadataNames = (links, categoryMatcher) => {
    if (!Array.isArray(links)) {
        return [];
    }

    return links.reduce((names, link) => {
        const category = typeof link?.category === 'string' ? link.category.trim().toLowerCase() : '';
        const name = typeof link?.name === 'string' ? link.name.trim() : '';
        if (name && categoryMatcher(category) && !names.includes(name)) {
            names.push(name);
        }
        return names;
    }, []);
};

const getReleaseLabel = (group) => {
    if (group.releaseInfo) {
        return group.releaseInfo;
    }

    const released = group.titleReleased ? new Date(group.titleReleased) : null;
    return released && !Number.isNaN(released.getTime()) ? `${released.getFullYear()}` : null;
};

const DownloadMediaDetails = ({
    group,
    refreshing,
    error,
    actionStates,
    actionErrors,
    onBack,
    onCancel,
    onRetry,
    onPlay,
    onOpenLocation,
    onRemove
}) => {
    const { t } = useTranslation();
    const isMovie = group.type === 'movie';
    const playableRecord = group.latestCompletedRecord;
    const playableRecordId = playableRecord?.id;
    const playAction = playableRecordId ? actionStates[playableRecordId] : null;
    const playActionInProgress = typeof playAction === 'string';
    const heroArtwork = group.background || group.poster || getRecordArtwork(group.records[0], group);
    const posterArtwork = group.poster || heroArtwork;
    const genres = getMetadataNames(group.metaLinks, (category) => category.includes('genre'));
    const cast = getMetadataNames(group.metaLinks, (category) => category.includes('cast') || category.includes('actor')).slice(0, 8);
    const directors = getMetadataNames(group.metaLinks, (category) => category.includes('director')).slice(0, 4);
    const imdbScore = getMetadataNames(group.metaLinks, (category) => category === 'imdb')[0] || null;
    const releaseLabel = getReleaseLabel(group);
    const [selectedSeasonKey, setSelectedSeasonKey] = React.useState(null);
    const seasonGroups = React.useMemo(() => isMovie ? [] : groupSeriesRecordsBySeason(group.records), [group.records, isMovie]);
    const selectedSeasonGroup = seasonGroups.find(({ key }) => key === selectedSeasonKey) || seasonGroups[0] || null;
    const displayedRecords = isMovie ? group.records : selectedSeasonGroup?.records || [];
    const itemCountLabel = group.type === 'series' ?
        t('CUSTOM_DOWNLOADS_EPISODE_COUNT', {
            defaultValue: group.episodeCount === 1 ? '{{count}} episode' : '{{count}} episodes',
            count: group.episodeCount
        })
        :
        t('CUSTOM_DOWNLOADS_FILE_COUNT', {
            defaultValue: group.records.length === 1 ? '{{count}} file' : '{{count}} files',
            count: group.records.length
        });

    return (
        <section className={styles['details-page']} aria-label={group.title}>
            <div className={styles['hero']}>
                {
                    heroArtwork ?
                        <Image className={styles['hero-background']} src={heroArtwork} alt={' '} />
                        :
                        null
                }
                <div className={styles['hero-shade']} />
                <div className={styles['details-toolbar']}>
                    <button type={'button'} className={styles['back-button']} onClick={onBack}>
                        <span className={styles['back-symbol']} aria-hidden={'true'} />
                        <span>{t('CUSTOM_DOWNLOADS_BACK_TO_LIBRARY', { defaultValue: 'Back to downloads' })}</span>
                    </button>
                    <div className={styles['toolbar-actions']}>
                        {refreshing ? <span className={styles['refreshing-label']}>{t('CUSTOM_DOWNLOADS_REFRESHING', { defaultValue: 'Refreshing...' })}</span> : null}
                        {group.href ? <Button className={styles['stremio-link']} href={group.href}>{t('CUSTOM_DOWNLOADS_VIEW_TITLE', { defaultValue: 'View in Stremio' })}</Button> : null}
                    </div>
                </div>
                <div className={styles['hero-content']}>
                    <div className={styles['hero-poster-container']}>
                        {
                            posterArtwork ?
                                <Image className={styles['hero-poster']} src={posterArtwork} alt={group.title} />
                                :
                                <div className={styles['hero-poster-fallback']} aria-hidden={'true'}><Icon name={'download'} /></div>
                        }
                    </div>
                    <div className={styles['hero-info']}>
                        <div className={styles['media-type']}>{group.type === 'series' ? t('CUSTOM_DOWNLOADS_SERIES', { defaultValue: 'Series' }) : t('CUSTOM_DOWNLOADS_MOVIE', { defaultValue: 'Movie' })}</div>
                        {
                            group.logo ?
                                <React.Fragment>
                                    <Image className={styles['title-logo']} src={group.logo} alt={group.title} title={group.title} />
                                    <h1 className={styles['visually-hidden']}>{group.title}</h1>
                                </React.Fragment>
                                :
                                <h1 className={styles['title']} title={group.title}>{group.title}</h1>
                        }
                        {
                            releaseLabel || group.runtime || imdbScore ?
                                <div className={styles['title-facts']}>
                                    {releaseLabel ? <span>{releaseLabel}</span> : null}
                                    {group.runtime ? <span>{group.runtime}</span> : null}
                                    {
                                        imdbScore ?
                                            <span className={styles['imdb-score']}><Icon name={'imdb'} />{imdbScore}</span>
                                            :
                                            null
                                    }
                                </div>
                                :
                                null
                        }
                        <div className={styles['summary-line']}>
                            <span>{itemCountLabel}</span>
                            {group.completedCount > 0 ? <span>{t('CUSTOM_DOWNLOADS_READY_COUNT', { defaultValue: '{{count}} ready', count: group.completedCount })}</span> : null}
                            {group.activeCount > 0 ? <span>{t('CUSTOM_DOWNLOADS_ACTIVE_COUNT', { defaultValue: '{{count}} active', count: group.activeCount })}</span> : null}
                            {group.attentionCount > 0 ? <span className={styles['attention-label']}>{t('CUSTOM_DOWNLOADS_ISSUE_COUNT', { defaultValue: '{{count}} needs attention', count: group.attentionCount })}</span> : null}
                        </div>
                        <p className={styles['hero-description']}>
                            {group.description || (isMovie ?
                                t('CUSTOM_DOWNLOADS_MOVIE_DETAILS_DESCRIPTION', { defaultValue: 'Play the newest completed copy or choose another download below.' })
                                :
                                t('CUSTOM_DOWNLOADS_SHOW_DETAILS_DESCRIPTION', { defaultValue: 'Choose a downloaded episode to play or manage its local record.' }))}
                        </p>
                        {
                            genres.length > 0 ?
                                <div className={styles['genres']} aria-label={t('CUSTOM_DOWNLOADS_GENRES', { defaultValue: 'Genres' })}>
                                    {genres.map((genre) => <span key={genre}>{genre}</span>)}
                                </div>
                                :
                                null
                        }
                        {
                            directors.length > 0 || cast.length > 0 ?
                                <div className={styles['credits']}>
                                    {directors.length > 0 ? <div><span>{t('CUSTOM_DOWNLOADS_DIRECTORS', { defaultValue: directors.length === 1 ? 'Director' : 'Directors' })}</span><strong>{directors.join(', ')}</strong></div> : null}
                                    {cast.length > 0 ? <div><span>{t('CUSTOM_DOWNLOADS_CAST', { defaultValue: 'Cast' })}</span><strong>{cast.join(', ')}</strong></div> : null}
                                </div>
                                :
                                null
                        }
                        {
                            isMovie && playableRecordId ?
                                <button
                                    type={'button'}
                                    className={styles['hero-play-button']}
                                    disabled={playActionInProgress}
                                    onClick={() => !playActionInProgress && onPlay?.(playableRecordId)}
                                >
                                    <Icon name={'play'} />
                                    <span>{playAction === 'play' ? t('CUSTOM_DOWNLOAD_OPENING', { defaultValue: 'Opening...' }) : t('CUSTOM_DOWNLOADS_PLAY_LATEST', { defaultValue: 'Play latest download' })}</span>
                                </button>
                                :
                                null
                        }
                    </div>
                </div>
            </div>

            {error ? <div className={styles['offline-banner']} role={'status'}>{error}</div> : null}

            <div className={styles['downloads-section']}>
                <div className={styles['section-heading']}>
                    <div>
                        <div className={styles['section-eyebrow']}>{isMovie ? t('CUSTOM_DOWNLOADS_VERSIONS', { defaultValue: 'Local versions' }) : t('CUSTOM_DOWNLOADS_EPISODES', { defaultValue: 'Downloaded episodes' })}</div>
                        <h2 className={styles['section-title']}>{isMovie ? t('CUSTOM_DOWNLOADS_CHOOSE_DOWNLOAD', { defaultValue: 'Choose a download' }) : t('CUSTOM_DOWNLOADS_CHOOSE_EPISODE', { defaultValue: 'Choose an episode' })}</h2>
                    </div>
                    <span className={styles['record-count']}>{displayedRecords.length}</span>
                </div>
                {
                    !isMovie && seasonGroups.length > 0 ?
                        <div className={styles['season-selector']} role={'tablist'} aria-label={t('CUSTOM_DOWNLOADS_SEASONS', { defaultValue: 'Seasons' })}>
                            {seasonGroups.map((seasonGroup) => {
                                const selected = seasonGroup.key === selectedSeasonGroup?.key;
                                const seasonLabel = seasonGroup.season === null ?
                                    t('CUSTOM_DOWNLOADS_OTHER_EPISODES', { defaultValue: 'Other episodes' })
                                    :
                                    t('CUSTOM_DOWNLOADS_SEASON_NUMBER', { defaultValue: 'Season {{season}}', season: seasonGroup.season });
                                return (
                                    <button
                                        type={'button'}
                                        role={'tab'}
                                        key={seasonGroup.key}
                                        className={selected ? styles['season-button-selected'] : styles['season-button']}
                                        aria-selected={selected}
                                        onClick={() => setSelectedSeasonKey(seasonGroup.key)}
                                    >
                                        <span>{seasonLabel}</span>
                                        <small>{seasonGroup.records.length}</small>
                                    </button>
                                );
                            })}
                        </div>
                        :
                        null
                }
                <div className={styles['record-list']}>
                    {displayedRecords.map((record) => {
                        const artwork = getRecordArtwork(record, group);
                        const artworkLabel = getRecordArtworkLabel(record, group.title);
                        return (
                            <div className={styles['record-row']} key={record.id || `${record.videoId}-${record.createdAt}`}>
                                <div className={styles['thumbnail-container']}>
                                    {
                                        artwork ?
                                            <Image className={styles['thumbnail']} src={artwork} alt={artworkLabel} />
                                            :
                                            <div className={styles['thumbnail-fallback']} aria-hidden={'true'}><Icon name={'play'} /></div>
                                    }
                                    <div className={styles['thumbnail-label']} title={artworkLabel}>{artworkLabel}</div>
                                </div>
                                <DownloadRecordCard
                                    record={record}
                                    variant={'library'}
                                    action={record.id ? actionStates[record.id] : null}
                                    actionError={record.id ? actionErrors[record.id] : null}
                                    onCancel={onCancel}
                                    onRetry={onRetry}
                                    onPlay={onPlay}
                                    onOpenLocation={onOpenLocation}
                                    onRemove={onRemove}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
};

DownloadMediaDetails.propTypes = {
    group: PropTypes.shape({
        title: PropTypes.string.isRequired,
        type: PropTypes.string,
        poster: PropTypes.string,
        background: PropTypes.string,
        logo: PropTypes.string,
        description: PropTypes.string,
        runtime: PropTypes.string,
        releaseInfo: PropTypes.string,
        titleReleased: PropTypes.string,
        metaLinks: PropTypes.arrayOf(PropTypes.object),
        records: PropTypes.arrayOf(PropTypes.object).isRequired,
        episodeCount: PropTypes.number.isRequired,
        activeCount: PropTypes.number.isRequired,
        completedCount: PropTypes.number.isRequired,
        attentionCount: PropTypes.number.isRequired,
        latestCompletedRecord: PropTypes.object,
        href: PropTypes.string
    }).isRequired,
    refreshing: PropTypes.bool,
    error: PropTypes.string,
    actionStates: PropTypes.object.isRequired,
    actionErrors: PropTypes.object.isRequired,
    onBack: PropTypes.func.isRequired,
    onCancel: PropTypes.func,
    onRetry: PropTypes.func,
    onPlay: PropTypes.func,
    onOpenLocation: PropTypes.func,
    onRemove: PropTypes.func
};

module.exports = DownloadMediaDetails;

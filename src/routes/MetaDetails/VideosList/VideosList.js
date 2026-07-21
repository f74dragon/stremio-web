// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { t } = require('i18next');
const { useCore } = require('stremio/core');
const { useProfile } = require('stremio/common');
const { Image, SearchBar, Toggle, Video, Button } = require('stremio/components');
const { default: Icon } = require('@stremio/stremio-icons/react');
const {
    BATCH_PROVIDER_POLICY,
    getNextUnassignedBatchEpisode
} = require('stremio/customStremio/batchDownloadSelection');
const SeasonsBar = require('./SeasonsBar');
const { default: EpisodePicker } = require('../EpisodePicker');
const styles = require('./styles');

let savedScrollTop = 0;

const VideosList = ({
    className,
    metaItem,
    libraryItem,
    season,
    seasonOnSelect,
    selectedVideoId,
    toggleNotifications,
    batchDownloadSession,
    onStartBatchDownload,
    onCancelBatchDownload
}) => {
    const core = useCore();
    const profile = useProfile();
    const showNotificationsToggle = React.useMemo(() => {
        return metaItem?.content?.content?.inLibrary && metaItem?.content?.content?.videos?.length;
    }, [metaItem]);
    const videos = React.useMemo(() => {
        return metaItem && metaItem.content.type === 'Ready' ?
            metaItem.content.content.videos
            :
            [];
    }, [metaItem]);
    const seasons = React.useMemo(() => {
        return videos
            .map(({ season }) => season)
            .filter((season, index, seasons) => {
                return season !== null &&
                    !isNaN(season) &&
                    typeof season === 'number' &&
                    seasons.indexOf(season) === index;
            })
            .sort((a, b) => (a || Number.MAX_SAFE_INTEGER) - (b || Number.MAX_SAFE_INTEGER));
    }, [videos]);
    const selectedSeason = React.useMemo(() => {
        if (seasons.includes(season)) {
            return season;
        }

        const video = videos?.find((video) => video.id === libraryItem?.state.video_id);

        if (video && video.season && seasons.includes(video.season)) {
            return video.season;
        }

        const nonSpecialSeasons = seasons.filter((season) => season !== 0);
        if (nonSpecialSeasons.length > 0) {
            return nonSpecialSeasons[0];
        }

        if (seasons.length > 0) {
            return seasons[0];
        }

        return null;
    }, [seasons, season, videos, libraryItem]);
    const videosForSeason = React.useMemo(() => {
        return videos
            .filter((video) => {
                return selectedSeason === null || video.season === selectedSeason;
            })
            .sort((a, b) => {
                return a.episode - b.episode;
            });
    }, [videos, selectedSeason]);

    const seasonWatched = React.useMemo(() => {
        return videosForSeason.every((video) => video.watched);
    }, [videosForSeason]);

    const videosContainerRef = React.useRef(null);
    const isMountedRef = React.useRef(false);

    const saveScrollPosition = React.useCallback(() => {
        savedScrollTop = videosContainerRef.current?.scrollTop ?? 0;
    }, []);

    // Restore scroll on mount (before paint), consume immediately
    React.useLayoutEffect(() => {
        if (savedScrollTop > 0 && videosContainerRef.current) {
            videosContainerRef.current.scrollTop = savedScrollTop;
            savedScrollTop = 0;
        }
    }, []);

    // Scroll to top when the season changes (skip on initial mount to respect restored scroll position)
    React.useEffect(() => {
        if (!isMountedRef.current) {
            isMountedRef.current = true;
            return;
        }
        const hasSelectedVideo = videosForSeason.some((v) => v.id === selectedVideoId);
        if (!hasSelectedVideo && videosContainerRef.current) {
            videosContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }, [selectedSeason]);

    const [search, setSearch] = React.useState('');
    const [batchMode, setBatchMode] = React.useState(false);
    const [selectedBatchVideoIds, setSelectedBatchVideoIds] = React.useState(() => new Set());
    const [batchProviderPolicy, setBatchProviderPolicy] = React.useState(BATCH_PROVIDER_POLICY.EITHER);
    const searchInputOnChange = React.useCallback((event) => {
        setSearch(event.currentTarget.value);
    }, []);
    const eligibleBatchVideos = React.useMemo(() => videos.filter((video) => !video.upcoming && typeof video?.deepLinks?.metaDetailsStreams === 'string'), [videos]);
    const eligibleSeasonVideoIds = React.useMemo(() => videosForSeason
        .filter((video) => !video.upcoming && typeof video?.deepLinks?.metaDetailsStreams === 'string')
        .map(({ id }) => id), [videosForSeason]);
    const allSeasonSelected = eligibleSeasonVideoIds.length > 0 && eligibleSeasonVideoIds.every((id) => selectedBatchVideoIds.has(id));
    const toggleBatchVideo = React.useCallback((videoId) => {
        setSelectedBatchVideoIds((currentIds) => {
            const nextIds = new Set(currentIds);
            if (nextIds.has(videoId)) {
                nextIds.delete(videoId);
            } else {
                nextIds.add(videoId);
            }
            return nextIds;
        });
    }, []);
    const toggleBatchSeason = React.useCallback(() => {
        setSelectedBatchVideoIds((currentIds) => {
            const nextIds = new Set(currentIds);
            if (eligibleSeasonVideoIds.every((id) => nextIds.has(id))) {
                eligibleSeasonVideoIds.forEach((id) => nextIds.delete(id));
            } else {
                eligibleSeasonVideoIds.forEach((id) => nextIds.add(id));
            }
            return nextIds;
        });
    }, [eligibleSeasonVideoIds]);
    const cancelBatchSelection = React.useCallback(() => {
        setBatchMode(false);
        setSelectedBatchVideoIds(new Set());
    }, []);
    const startBatchReview = React.useCallback(() => {
        if (selectedBatchVideoIds.size === 0 || typeof onStartBatchDownload !== 'function') {
            return;
        }
        const selectedEpisodes = eligibleBatchVideos
            .filter(({ id }) => selectedBatchVideoIds.has(id))
            .sort((left, right) => (left.season ?? Number.MAX_SAFE_INTEGER) - (right.season ?? Number.MAX_SAFE_INTEGER) ||
                (left.episode ?? Number.MAX_SAFE_INTEGER) - (right.episode ?? Number.MAX_SAFE_INTEGER))
            .map((video) => ({
                id: video.id,
                title: video.title,
                season: video.season,
                episode: video.episode,
                thumbnail: video.thumbnail,
                href: video.deepLinks.metaDetailsStreams
            }));
        onStartBatchDownload({ episodes: selectedEpisodes, providerPolicy: batchProviderPolicy });
    }, [batchProviderPolicy, eligibleBatchVideos, onStartBatchDownload, selectedBatchVideoIds]);
    const nextBatchEpisode = getNextUnassignedBatchEpisode(batchDownloadSession);

    const onMarkVideoAsWatched = (video, watched) => {
        core.transport.dispatch({
            action: 'MetaDetails',
            args: {
                action: 'MarkVideoAsWatched',
                args: [video, !watched]
            }
        });
    };

    const onMarkSeasonAsWatched = (season, watched) => {
        core.transport.dispatch({
            action: 'MetaDetails',
            args: {
                action: 'MarkSeasonAsWatched',
                args: [season, !watched]
            }
        });
    };

    const onSeasonSearch = (value) => {
        if (value) {
            seasonOnSelect({
                type: 'select',
                value,
            });
        }
    };

    return (
        <div className={classnames(className, styles['videos-list-container'])}>
            {
                !metaItem || metaItem.content.type === 'Loading' ?
                    <React.Fragment>
                        <SeasonsBar.Placeholder className={styles['seasons-bar']} />
                        <SearchBar.Placeholder className={styles['search-bar']} title={t('SEARCH_VIDEOS')} />
                        <div className={styles['videos-scroll-container']}>
                            <Video.Placeholder />
                            <Video.Placeholder />
                            <Video.Placeholder />
                            <Video.Placeholder />
                            <Video.Placeholder />
                        </div>
                    </React.Fragment>
                    :
                    metaItem.content.type === 'Err' || videosForSeason.length === 0 ?
                        <div className={styles['message-container']}>
                            <EpisodePicker className={styles['episode-picker']} onSubmit={onSeasonSearch} />
                            <Image className={styles['image']} src={require('/assets/images/empty.png')} alt={' '} />
                            <div className={styles['label']}>{t('ERR_NO_VIDEOS_FOR_META')}</div>
                        </div>
                        :
                        <React.Fragment>
                            {
                                showNotificationsToggle && libraryItem ?
                                    <Toggle className={styles['notifications-toggle']} checked={!libraryItem.state.noNotif} onClick={toggleNotifications}>
                                        {t('DETAIL_RECEIVE_NOTIF_SERIES')}
                                    </Toggle>
                                    :
                                    null
                            }
                            {
                                seasons.length > 0 ?
                                    <SeasonsBar
                                        className={styles['seasons-bar']}
                                        season={selectedSeason}
                                        seasons={seasons}
                                        onSelect={seasonOnSelect}
                                    />
                                    :
                                    null
                            }
                            {batchDownloadSession ?
                                <div className={styles['batch-resume-bar']}>
                                    <div>
                                        <strong>{t('CUSTOM_BATCH_IN_PROGRESS', { defaultValue: 'Automatic source selection in progress' })}</strong>
                                        <span>{t('CUSTOM_BATCH_PROGRESS', {
                                            defaultValue: '{{selected}} of {{total}} episodes have sources',
                                            selected: Object.keys(batchDownloadSession.assignments || {}).length,
                                            total: batchDownloadSession.episodes.length
                                        })}</span>
                                    </div>
                                    {nextBatchEpisode ?
                                        <Button className={styles['batch-primary-action']} href={nextBatchEpisode.href}>
                                            {t('CUSTOM_BATCH_CONTINUE', { defaultValue: 'Continue review' })}
                                        </Button>
                                        : null}
                                    <Button className={styles['batch-secondary-action']} onClick={onCancelBatchDownload}>
                                        {t('CUSTOM_BATCH_CANCEL', { defaultValue: 'Cancel batch' })}
                                    </Button>
                                </div>
                                : <div className={styles['batch-toolbar']}>
                                    {!batchMode ?
                                        <Button className={styles['batch-start-button']} onClick={() => setBatchMode(true)}>
                                            <Icon name={'download'} />
                                            {t('CUSTOM_BATCH_SELECT_EPISODES', { defaultValue: 'Select episodes to download' })}
                                        </Button>
                                        : <React.Fragment>
                                            <div className={styles['batch-selection-summary']}>
                                                <strong>{t('CUSTOM_BATCH_SELECTED_COUNT', { defaultValue: '{{count}} selected', count: selectedBatchVideoIds.size })}</strong>
                                                <span>{t('CUSTOM_BATCH_SELECTION_HELP', { defaultValue: 'Choose episodes; the app will verify and select the best safe source for each.' })}</span>
                                            </div>
                                            <Button className={styles['batch-secondary-action']} disabled={eligibleSeasonVideoIds.length === 0} onClick={toggleBatchSeason}>
                                                {allSeasonSelected ? t('CUSTOM_BATCH_CLEAR_SEASON', { defaultValue: 'Clear season' }) : t('CUSTOM_BATCH_SELECT_SEASON', { defaultValue: 'Select season' })}
                                            </Button>
                                            <label className={styles['batch-provider-field']}>
                                                <span>{t('CUSTOM_BATCH_PROVIDER', { defaultValue: 'Provider' })}</span>
                                                <select value={batchProviderPolicy} onChange={(event) => setBatchProviderPolicy(event.target.value)}>
                                                    <option value={BATCH_PROVIDER_POLICY.EITHER}>{t('CUSTOM_BATCH_PROVIDER_EITHER', { defaultValue: 'AllDebrid or Real-Debrid' })}</option>
                                                    <option value={BATCH_PROVIDER_POLICY.ALLDEBRID}>{t('CUSTOM_BATCH_PROVIDER_ALLDEBRID', { defaultValue: 'AllDebrid only' })}</option>
                                                    <option value={BATCH_PROVIDER_POLICY.REALDEBRID}>{t('CUSTOM_BATCH_PROVIDER_REALDEBRID', { defaultValue: 'Real-Debrid only' })}</option>
                                                </select>
                                            </label>
                                            <Button className={styles['batch-secondary-action']} onClick={cancelBatchSelection}>
                                                {t('CUSTOM_BATCH_CANCEL', { defaultValue: 'Cancel' })}
                                            </Button>
                                            <Button className={styles['batch-primary-action']} disabled={selectedBatchVideoIds.size === 0} onClick={startBatchReview}>
                                                {t('CUSTOM_BATCH_REVIEW_SOURCES', { defaultValue: 'Find best sources' })}
                                            </Button>
                                        </React.Fragment>}
                                </div>}
                            <SearchBar
                                className={styles['search-bar']}
                                title={t('SEARCH_VIDEOS')}
                                value={search}
                                onChange={searchInputOnChange}
                            />
                            <div ref={videosContainerRef} className={styles['videos-container']}>
                                {
                                    videosForSeason
                                        .filter((video) => {
                                            return search.length === 0 ||
                                                (
                                                    (typeof video.title === 'string' && video.title.toLowerCase().includes(search.toLowerCase())) ||
                                                    (!isNaN(video.released.getTime()) && video.released.toLocaleString(profile.settings.interfaceLanguage, { year: '2-digit', month: 'short', day: 'numeric' }).toLowerCase().includes(search.toLowerCase()))
                                                );
                                        })
                                        .map((video, index) => (
                                            <div className={classnames(styles['batch-video-row'], batchMode ? styles['batch-video-row-active'] : null, batchMode && selectedBatchVideoIds.has(video.id) ? styles['batch-video-row-selected'] : null)} key={index} onClick={saveScrollPosition}>
                                                {batchMode && !video.upcoming && typeof video?.deepLinks?.metaDetailsStreams === 'string' ?
                                                    <button
                                                        type={'button'}
                                                        className={styles['batch-video-selector']}
                                                        aria-pressed={selectedBatchVideoIds.has(video.id)}
                                                        aria-label={t('CUSTOM_BATCH_TOGGLE_EPISODE', { defaultValue: 'Select {{title}} for batch download', title: video.title || video.id })}
                                                        onClick={() => toggleBatchVideo(video.id)}
                                                    >
                                                        <Icon name={selectedBatchVideoIds.has(video.id) ? 'checkmark' : 'plus'} />
                                                    </button>
                                                    : null}
                                                <Video
                                                    id={video.id}
                                                    title={video.title}
                                                    thumbnail={video.thumbnail}
                                                    season={video.season}
                                                    episode={video.episode}
                                                    released={video.released}
                                                    upcoming={video.upcoming}
                                                    watched={video.watched}
                                                    progress={video.progress}
                                                    deepLinks={batchMode ? null : video.deepLinks}
                                                    scheduled={video.scheduled}
                                                    seasonWatched={seasonWatched}
                                                    selected={video.id === selectedVideoId}
                                                    onMarkVideoAsWatched={onMarkVideoAsWatched}
                                                    onMarkSeasonAsWatched={onMarkSeasonAsWatched}
                                                />
                                            </div>
                                        ))
                                }
                            </div>
                        </React.Fragment>
            }
        </div>
    );
};

VideosList.propTypes = {
    className: PropTypes.string,
    metaItem: PropTypes.object,
    libraryItem: PropTypes.object,
    season: PropTypes.number,
    selectedVideoId: PropTypes.string,
    seasonOnSelect: PropTypes.func,
    toggleNotifications: PropTypes.func,
    batchDownloadSession: PropTypes.object,
    onStartBatchDownload: PropTypes.func,
    onCancelBatchDownload: PropTypes.func,
};

module.exports = VideosList;

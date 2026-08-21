const React = require('react');
const PropTypes = require('prop-types');
const { useTranslation } = require('react-i18next');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { Button, Image } = require('stremio/components');
const {
    HISTORY_FILTERS,
    HISTORY_LIBRARY_SORTS,
    filterAndSortDownloadHistoryGroups,
    getDownloadHistoryFilterCounts,
    groupHistoryAttemptsBySeason
} = require('../downloadHistoryPresentation');
const { getDownloadTitleHref } = require('../downloadRecordPresentation');
const DownloadLibraryToolbar = require('./DownloadLibraryToolbar');
const styles = require('./DownloadHistoryBrowser.less');

const getHistoryTitleHref = (group) => ['movie', 'series'].includes(group?.type) ? getDownloadTitleHref(group) : null;

const formatDate = (value) => {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
        return null;
    }
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(new Date(timestamp));
};

const formatBytes = (value) => {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) {
        return null;
    }
    if (bytes < 1024) {
        return `${Math.round(bytes)} B`;
    }
    const units = ['KB', 'MB', 'GB', 'TB'];
    let amount = bytes;
    let unit = -1;
    do {
        amount /= 1024;
        unit += 1;
    } while (amount >= 1024 && unit < units.length - 1);
    return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
};

const getOutcomeLabel = (outcome, t) => {
    const labels = {
        active: t('CUSTOM_HISTORY_OUTCOME_ACTIVE', { defaultValue: 'Current' }),
        completed: t('CUSTOM_HISTORY_OUTCOME_COMPLETED', { defaultValue: 'Completed' }),
        failed: t('CUSTOM_HISTORY_OUTCOME_FAILED', { defaultValue: 'Failed' }),
        canceled: t('CUSTOM_HISTORY_OUTCOME_CANCELED', { defaultValue: 'Canceled' }),
        partial: t('CUSTOM_HISTORY_OUTCOME_PARTIAL', { defaultValue: 'Partial' }),
        deleted: t('CUSTOM_HISTORY_OUTCOME_DELETED', { defaultValue: 'Media deleted' }),
        removed: t('CUSTOM_HISTORY_OUTCOME_REMOVED', { defaultValue: 'Record removed' })
    };
    return labels[outcome] || labels.partial;
};

const getEventLabel = (eventType, t) => {
    const labels = {
        download_created: t('CUSTOM_HISTORY_EVENT_CREATED', { defaultValue: 'Added to downloads' }),
        download_started: t('CUSTOM_HISTORY_EVENT_STARTED', { defaultValue: 'Download started' }),
        download_paused: t('CUSTOM_HISTORY_EVENT_PAUSED', { defaultValue: 'Download paused' }),
        download_resumed: t('CUSTOM_HISTORY_EVENT_RESUMED', { defaultValue: 'Download resumed' }),
        download_retried: t('CUSTOM_HISTORY_EVENT_RETRIED', { defaultValue: 'Download retried' }),
        download_completed: t('CUSTOM_HISTORY_EVENT_COMPLETED', { defaultValue: 'Download completed' }),
        download_failed: t('CUSTOM_HISTORY_EVENT_FAILED', { defaultValue: 'Download failed' }),
        download_canceled: t('CUSTOM_HISTORY_EVENT_CANCELED', { defaultValue: 'Download canceled' }),
        download_interrupted: t('CUSTOM_HISTORY_EVENT_INTERRUPTED', { defaultValue: 'Backend interruption recovered' }),
        record_backfilled: t('CUSTOM_HISTORY_EVENT_BACKFILLED', { defaultValue: 'Existing record added to history' }),
        record_removal_requested: t('CUSTOM_HISTORY_EVENT_REMOVE_REQUESTED', { defaultValue: 'Record removal requested' }),
        record_removed: t('CUSTOM_HISTORY_EVENT_REMOVED', { defaultValue: 'Record removed' }),
        media_deletion_requested: t('CUSTOM_HISTORY_EVENT_DELETE_REQUESTED', { defaultValue: 'Media deletion requested' }),
        media_deleted: t('CUSTOM_HISTORY_EVENT_MEDIA_DELETED', { defaultValue: 'Local media deleted' })
    };
    return labels[eventType] || t('CUSTOM_HISTORY_EVENT_UPDATED', { defaultValue: 'Download updated' });
};

const OutcomeBadge = ({ outcome }) => {
    const { t } = useTranslation();
    return <span className={styles[`outcome-${outcome}`] || styles['outcome-partial']}>{getOutcomeLabel(outcome, t)}</span>;
};

OutcomeBadge.propTypes = {
    outcome: PropTypes.string.isRequired
};

const HistoryTimeline = ({ events }) => {
    const { t } = useTranslation();
    return (
        <ol className={styles['timeline']}>
            {events.map((event, index) => {
                const freed = formatBytes(event?.details?.bytesFreed);
                return (
                    <li key={event.eventId || `${event.eventType}-${event.occurredAt}-${index}`}>
                        <span className={styles['timeline-dot']} aria-hidden={'true'} />
                        <div>
                            <strong>{getEventLabel(event.eventType, t)}</strong>
                            <span>{formatDate(event.occurredAt) || t('CUSTOM_HISTORY_DATE_UNKNOWN', { defaultValue: 'Date unavailable' })}</span>
                            {freed ? <small>{t('CUSTOM_HISTORY_SPACE_FREED', { defaultValue: '{{size}} removed from this device', size: freed })}</small> : null}
                        </div>
                    </li>
                );
            })}
        </ol>
    );
};

HistoryTimeline.propTypes = {
    events: PropTypes.arrayOf(PropTypes.object).isRequired
};

const getProviderLabel = (provider) => {
    switch (provider?.toLowerCase()) {
        case 'alldebrid':
            return 'AllDebrid';
        case 'realdebrid':
            return 'Real-Debrid';
        default:
            return provider;
    }
};

const HistoryAttempt = ({ attempt }) => {
    const { t } = useTranslation();
    const size = formatBytes(attempt.result?.bytesTotal ?? attempt.result?.bytesDownloaded);
    const sourceName = attempt.source?.streamName || attempt.source?.fileName || t('CUSTOM_HISTORY_SOURCE_UNKNOWN', { defaultValue: 'Unknown source' });
    const provider = getProviderLabel(attempt.source?.provider) || attempt.source?.addonName;
    return (
        <article className={styles['attempt-card']}>
            <div className={styles['attempt-header']}>
                <div>
                    <div className={styles['attempt-title-row']}>
                        <h4 title={sourceName}>{sourceName}</h4>
                        <OutcomeBadge outcome={attempt.outcome} />
                        {attempt.current ? <span className={styles['current-record']}>{t('CUSTOM_HISTORY_STILL_IN_DOWNLOADS', { defaultValue: 'Still in Downloads' })}</span> : null}
                    </div>
                    <div className={styles['attempt-meta']}>
                        <span>{t('CUSTOM_HISTORY_ATTEMPT_NUMBER', { defaultValue: 'Attempt {{number}}', number: attempt.attemptNumber })}</span>
                        {provider ? <span>{provider}</span> : null}
                        {size ? <span>{size}</span> : null}
                        {attempt.latestAt ? <span>{formatDate(attempt.latestAt)}</span> : null}
                    </div>
                </div>
            </div>
            <HistoryTimeline events={[...attempt.events].reverse()} />
        </article>
    );
};

HistoryAttempt.propTypes = {
    attempt: PropTypes.object.isRequired
};

const HistoryDetails = ({ group, onBack, onNavigate }) => {
    const { t } = useTranslation();
    const isSeries = group.type === 'series';
    const seasons = React.useMemo(() => isSeries ? groupHistoryAttemptsBySeason(group.attempts) : [], [group.attempts, isSeries]);
    const [selectedSeasonKey, setSelectedSeasonKey] = React.useState(seasons[0]?.key || null);
    React.useEffect(() => {
        if (!seasons.some(({ key }) => key === selectedSeasonKey)) {
            setSelectedSeasonKey(seasons[0]?.key || null);
        }
    }, [seasons, selectedSeasonKey]);
    const selectedSeason = seasons.find(({ key }) => key === selectedSeasonKey) || seasons[0] || null;
    const countLabel = isSeries ?
        t('CUSTOM_HISTORY_EPISODE_COUNT', { defaultValue: group.episodeCount === 1 ? '{{count}} episode' : '{{count}} episodes', count: group.episodeCount })
        : t('CUSTOM_HISTORY_ATTEMPT_COUNT', { defaultValue: group.attemptCount === 1 ? '{{count}} attempt' : '{{count}} attempts', count: group.attemptCount });
    const titleHref = getHistoryTitleHref(group);

    return (
        <section className={styles['details']}>
            <button type={'button'} className={styles['back-button']} onClick={onBack}>
                <Icon name={'caret-left'} />
                {t('CUSTOM_HISTORY_BACK', { defaultValue: 'Back to history' })}
            </button>
            <div className={styles['details-hero']}>
                <div className={styles['details-poster']}>
                    {group.poster ? <Image src={group.poster} alt={group.title} /> : <div><Icon name={'download'} /></div>}
                </div>
                <div className={styles['details-copy']}>
                    <div className={styles['details-eyebrow']}>{isSeries ? t('CUSTOM_HISTORY_SERIES', { defaultValue: 'Series history' }) : t('CUSTOM_HISTORY_MOVIE', { defaultValue: 'Movie history' })}</div>
                    <h2>{group.title}</h2>
                    <div className={styles['details-facts']}>
                        <span>{countLabel}</span>
                        <span>{t('CUSTOM_HISTORY_EVENT_COUNT', { defaultValue: '{{count}} lifecycle events', count: group.attempts.reduce((total, attempt) => total + attempt.events.length, 0) })}</span>
                        {group.latestAt ? <span>{t('CUSTOM_HISTORY_LAST_ACTIVITY', { defaultValue: 'Last activity {{date}}', date: formatDate(group.latestAt) })}</span> : null}
                    </div>
                    <p>{t('CUSTOM_HISTORY_READ_ONLY_NOTE', { defaultValue: 'This read-only timeline remains available even after local files and active download records are removed.' })}</p>
                    {titleHref ?
                        <Button
                            className={styles['details-title-link']}
                            href={titleHref}
                            title={t('CUSTOM_HISTORY_OPEN_STREMIO_TITLE', { defaultValue: 'Open the Stremio title page for {{title}}', title: group.title })}
                            onClick={() => onNavigate?.()}
                        >
                            <span>{t('CUSTOM_HISTORY_VIEW_TITLE_PAGE', { defaultValue: 'View title page' })}</span>
                            <Icon name={'caret-right'} />
                        </Button>
                        : null}
                </div>
            </div>

            {isSeries && seasons.length > 0 ?
                <div className={styles['season-tabs']} role={'tablist'} aria-label={t('CUSTOM_HISTORY_SEASONS', { defaultValue: 'History seasons' })}>
                    {seasons.map((season) => (
                        <button
                            type={'button'}
                            role={'tab'}
                            aria-selected={season.key === selectedSeason?.key}
                            className={season.key === selectedSeason?.key ? styles['season-tab-selected'] : styles['season-tab']}
                            key={season.key}
                            onClick={() => setSelectedSeasonKey(season.key)}
                        >
                            <span>{season.season === null ? t('CUSTOM_HISTORY_OTHER_EPISODES', { defaultValue: 'Other' }) : t('CUSTOM_HISTORY_SEASON_NUMBER', { defaultValue: 'Season {{number}}', number: season.season })}</span>
                            <small>{season.episodes.length}</small>
                        </button>
                    ))}
                </div>
                : null}

            <div className={styles['attempts-list']}>
                {isSeries ? selectedSeason?.episodes.map((episode) => (
                    <section className={styles['episode-section']} key={episode.key}>
                        <div className={styles['episode-header']}>
                            <div>
                                <strong>{episode.season !== null && episode.episode !== null ? `S${episode.season} E${episode.episode}` : t('CUSTOM_HISTORY_EPISODE', { defaultValue: 'Episode' })}</strong>
                                <span>{episode.title}</span>
                            </div>
                            <small>{t('CUSTOM_HISTORY_ATTEMPT_COUNT', { defaultValue: episode.attempts.length === 1 ? '{{count}} attempt' : '{{count}} attempts', count: episode.attempts.length })}</small>
                        </div>
                        {episode.attempts.map((attempt) => <HistoryAttempt key={attempt.key} attempt={attempt} />)}
                    </section>
                )) : group.attempts.map((attempt) => <HistoryAttempt key={attempt.key} attempt={attempt} />)}
            </div>
        </section>
    );
};

HistoryDetails.propTypes = {
    group: PropTypes.object.isRequired,
    onBack: PropTypes.func.isRequired,
    onNavigate: PropTypes.func
};

const DownloadHistoryBrowser = ({
    groups,
    searchValue,
    fromValue,
    toValue,
    sortValue,
    eventCount,
    total,
    invalidEntryCount,
    initialLoading,
    refreshing,
    error,
    onRefresh,
    onSearchChange,
    onFromChange,
    onToChange,
    onSortChange,
    onNavigate
}) => {
    const { t } = useTranslation();
    const [filter, setFilter] = React.useState(HISTORY_FILTERS.ALL);
    const [selectedGroupKey, setSelectedGroupKey] = React.useState(null);
    const selectedGroup = groups.find(({ key }) => key === selectedGroupKey) || null;
    const filterCounts = React.useMemo(() => getDownloadHistoryFilterCounts(groups), [groups]);
    const filteredGroups = React.useMemo(() => filterAndSortDownloadHistoryGroups(groups, {
        filter,
        query: searchValue,
        sort: sortValue
    }), [filter, groups, searchValue, sortValue]);
    const filters = [
        { key: HISTORY_FILTERS.ALL, label: t('CUSTOM_HISTORY_FILTER_ALL', { defaultValue: 'All' }) },
        { key: HISTORY_FILTERS.COMPLETED, label: t('CUSTOM_HISTORY_FILTER_COMPLETED', { defaultValue: 'Completed' }) },
        { key: HISTORY_FILTERS.ATTENTION, label: t('CUSTOM_HISTORY_FILTER_ATTENTION', { defaultValue: 'Needs attention' }) },
        { key: HISTORY_FILTERS.DELETED, label: t('CUSTOM_HISTORY_FILTER_DELETED', { defaultValue: 'Deleted' }) }
    ];
    const sortOptions = [
        { value: HISTORY_LIBRARY_SORTS.RECENT, label: t('CUSTOM_HISTORY_SORT_RECENT', { defaultValue: 'Latest activity' }) },
        { value: HISTORY_LIBRARY_SORTS.OLDEST, label: t('CUSTOM_HISTORY_SORT_OLDEST', { defaultValue: 'Earliest activity' }) },
        { value: HISTORY_LIBRARY_SORTS.TITLE_ASC, label: t('CUSTOM_HISTORY_SORT_TITLE_ASC', { defaultValue: 'Title A-Z' }) },
        { value: HISTORY_LIBRARY_SORTS.TITLE_DESC, label: t('CUSTOM_HISTORY_SORT_TITLE_DESC', { defaultValue: 'Title Z-A' }) },
        { value: HISTORY_LIBRARY_SORTS.EPISODES_DESC, label: t('CUSTOM_HISTORY_SORT_EPISODES', { defaultValue: 'Most episodes' }) },
        { value: HISTORY_LIBRARY_SORTS.ATTEMPTS_DESC, label: t('CUSTOM_HISTORY_SORT_ATTEMPTS', { defaultValue: 'Most download attempts' }) }
    ];

    React.useEffect(() => {
        if (selectedGroupKey && !selectedGroup) {
            setSelectedGroupKey(null);
        }
    }, [selectedGroup, selectedGroupKey]);

    if (selectedGroup) {
        return <HistoryDetails
            group={selectedGroup}
            onBack={() => {
                setSelectedGroupKey(null);
                onNavigate?.();
            }}
            onNavigate={onNavigate}
        />;
    }

    return (
        <section className={styles['history-browser']}>
            <header className={styles['history-header']}>
                <div>
                    <div className={styles['eyebrow']}>{t('CUSTOM_HISTORY_EYEBROW', { defaultValue: 'Permanent local record' })}</div>
                    <h1>{t('CUSTOM_HISTORY_TITLE', { defaultValue: 'Download history' })}</h1>
                    <p>{t('CUSTOM_HISTORY_DESCRIPTION', { defaultValue: 'Past downloads remain here after their files or active records are removed.' })}</p>
                </div>
                <div className={styles['header-actions']}>
                    {refreshing ? <span>{t('CUSTOM_HISTORY_REFRESHING', { defaultValue: 'Refreshing...' })}</span> : null}
                    <Button disabled={refreshing} onClick={() => onRefresh?.()}>{t('CUSTOM_HISTORY_REFRESH', { defaultValue: 'Refresh history' })}</Button>
                </div>
            </header>

            {error && eventCount > 0 ? <div className={styles['offline-note']} role={'status'}>{t('CUSTOM_HISTORY_OFFLINE_STALE', { defaultValue: 'The backend is offline. Showing the most recently loaded history.' })} {error}</div> : null}
            {invalidEntryCount > 0 ? <div className={styles['warning-note']} role={'status'}><Icon name={'warning'} />{t('CUSTOM_HISTORY_CORRUPT_WARNING', { defaultValue: '{{count}} damaged history entries were safely skipped.', count: invalidEntryCount })}</div> : null}
            {total > eventCount ? <div className={styles['limit-note']}>{t('CUSTOM_HISTORY_LIMIT_NOTE', { defaultValue: 'Showing the newest {{shown}} of {{total}} events.', shown: eventCount, total })}</div> : null}

            {initialLoading && eventCount === 0 ?
                <div className={styles['state']} aria-live={'polite'}><Icon name={'download'} /><strong>{t('CUSTOM_HISTORY_LOADING', { defaultValue: 'Loading download history...' })}</strong></div>
                : error && eventCount === 0 ?
                    <div className={styles['state']} role={'alert'}><Icon name={'warning'} /><strong>{t('CUSTOM_HISTORY_OFFLINE', { defaultValue: 'History is unavailable' })}</strong><span>{error}</span><Button onClick={() => onRefresh?.()}>{t('CUSTOM_HISTORY_TRY_AGAIN', { defaultValue: 'Try again' })}</Button></div>
                    : groups.length === 0 ?
                        <div className={styles['state']}><Icon name={'download'} /><strong>{t('CUSTOM_HISTORY_EMPTY', { defaultValue: 'No download history yet' })}</strong><span>{t('CUSTOM_HISTORY_EMPTY_DESCRIPTION', { defaultValue: 'New downloads and lifecycle changes will be recorded here automatically.' })}</span></div>
                        : <React.Fragment>
                            <DownloadLibraryToolbar
                                label={t('CUSTOM_HISTORY_LIBRARY_CONTROLS', { defaultValue: 'Download history search and sorting' })}
                                searchValue={searchValue}
                                searchPlaceholder={t('CUSTOM_HISTORY_SEARCH_PLACEHOLDER', { defaultValue: 'Search titles and episodes' })}
                                clearLabel={t('CUSTOM_HISTORY_CLEAR_SEARCH', { defaultValue: 'Clear history search' })}
                                sortLabel={t('CUSTOM_HISTORY_SORT_LABEL', { defaultValue: 'Sort' })}
                                sortValue={sortValue}
                                sortOptions={sortOptions}
                                resultSummary={filteredGroups.length === groups.length ?
                                    t('CUSTOM_HISTORY_RESULT_TOTAL', {
                                        defaultValue: filteredGroups.length === 1 ? '{{count}} title' : '{{count}} titles',
                                        count: filteredGroups.length
                                    })
                                    : t('CUSTOM_HISTORY_RESULT_FILTERED', {
                                        defaultValue: '{{visible}} of {{total}} titles',
                                        visible: filteredGroups.length,
                                        total: groups.length
                                    })}
                                onSearchChange={onSearchChange}
                                onClear={() => onSearchChange('')}
                                onSortChange={onSortChange}
                            />
                            <div className={styles['date-range']} aria-label={t('CUSTOM_HISTORY_DATE_RANGE', { defaultValue: 'History date range' })}>
                                <label>
                                    <span>{t('CUSTOM_HISTORY_FROM_DATE', { defaultValue: 'From' })}</span>
                                    <input type={'date'} value={fromValue} max={toValue || undefined} onChange={(event) => onFromChange(event.target.value)} />
                                </label>
                                <label>
                                    <span>{t('CUSTOM_HISTORY_TO_DATE', { defaultValue: 'To' })}</span>
                                    <input type={'date'} value={toValue} min={fromValue || undefined} onChange={(event) => onToChange(event.target.value)} />
                                </label>
                                {fromValue || toValue ? <Button onClick={() => {
                                    onFromChange('');
                                    onToChange('');
                                }}>{t('CUSTOM_HISTORY_CLEAR_DATES', { defaultValue: 'Clear dates' })}</Button> : null}
                            </div>
                            <div className={styles['filter-bar']} role={'tablist'} aria-label={t('CUSTOM_HISTORY_FILTERS', { defaultValue: 'History filters' })}>
                                {filters.filter(({ key }) => key === HISTORY_FILTERS.ALL || filterCounts[key] > 0).map(({ key, label }) => (
                                    <button
                                        type={'button'}
                                        role={'tab'}
                                        aria-selected={filter === key}
                                        className={filter === key ? styles['filter-selected'] : styles['filter']}
                                        key={key}
                                        onClick={() => setFilter(key)}
                                    >
                                        <span>{label}</span><small>{filterCounts[key]}</small>
                                    </button>
                                ))}
                            </div>
                            {filteredGroups.length === 0 ?
                                <div className={styles['filtered-empty']}>{t('CUSTOM_HISTORY_FILTER_EMPTY', { defaultValue: 'No titles match this history filter.' })}</div>
                                : <div className={styles['history-grid']}>
                                    {filteredGroups.map((group) => {
                                        const isSeries = group.type === 'series';
                                        const titleHref = getHistoryTitleHref(group);
                                        const itemCount = isSeries ?
                                            t('CUSTOM_HISTORY_EPISODE_COUNT', { defaultValue: group.episodeCount === 1 ? '{{count}} episode' : '{{count}} episodes', count: group.episodeCount })
                                            : t('CUSTOM_HISTORY_ATTEMPT_COUNT', { defaultValue: group.attemptCount === 1 ? '{{count}} attempt' : '{{count}} attempts', count: group.attemptCount });
                                        return (
                                            <article className={styles['history-card']} key={group.key}>
                                                <button className={styles['history-card-button']} type={'button'} onClick={() => {
                                                    setSelectedGroupKey(group.key);
                                                    onNavigate?.();
                                                }} aria-label={t('CUSTOM_HISTORY_OPEN_TITLE', { defaultValue: 'Open history for {{title}}', title: group.title })}>
                                                    <div className={styles['poster-frame']}>
                                                        {group.poster ? <Image src={group.poster} alt={group.title} /> : <div className={styles['poster-fallback']}><Icon name={'download'} /></div>}
                                                        <div className={styles['poster-shade']} />
                                                        <div className={styles['poster-outcome']}><OutcomeBadge outcome={group.latestOutcome} /></div>
                                                        {group.currentCount > 0 ? <span className={styles['current-dot']} title={t('CUSTOM_HISTORY_CURRENT_TITLE', { defaultValue: 'This title still has a current download record' })} /> : null}
                                                    </div>
                                                </button>
                                                <div className={styles['card-copy']}>
                                                    {titleHref ?
                                                        <Button
                                                            className={styles['card-title-link']}
                                                            href={titleHref}
                                                            title={t('CUSTOM_HISTORY_OPEN_STREMIO_TITLE', { defaultValue: 'Open the Stremio title page for {{title}}', title: group.title })}
                                                            onClick={() => onNavigate?.()}
                                                        >
                                                            {group.title}
                                                        </Button>
                                                        : <strong title={group.title}>{group.title}</strong>}
                                                    <span>{itemCount}{group.latestAt ? ` · ${formatDate(group.latestAt)}` : ''}</span>
                                                </div>
                                            </article>
                                        );
                                    })}
                                </div>}
                        </React.Fragment>}
        </section>
    );
};

DownloadHistoryBrowser.propTypes = {
    groups: PropTypes.arrayOf(PropTypes.object).isRequired,
    searchValue: PropTypes.string.isRequired,
    fromValue: PropTypes.string.isRequired,
    toValue: PropTypes.string.isRequired,
    sortValue: PropTypes.string.isRequired,
    eventCount: PropTypes.number.isRequired,
    total: PropTypes.number.isRequired,
    invalidEntryCount: PropTypes.number.isRequired,
    initialLoading: PropTypes.bool,
    refreshing: PropTypes.bool,
    error: PropTypes.string,
    onRefresh: PropTypes.func,
    onSearchChange: PropTypes.func.isRequired,
    onFromChange: PropTypes.func.isRequired,
    onToChange: PropTypes.func.isRequired,
    onSortChange: PropTypes.func.isRequired,
    onNavigate: PropTypes.func
};

module.exports = DownloadHistoryBrowser;

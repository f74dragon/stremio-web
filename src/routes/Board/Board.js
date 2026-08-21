// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const debounce = require('lodash.debounce');
const useTranslate = require('stremio/common/useTranslate');
const { useStreamingServer, useNotifications, withCoreSuspender, getVisibleChildrenRange, useProfile } = require('stremio/common');
const { ContinueWatchingItem, EventModal, MainNavBars, MetaItem, MetaRow } = require('stremio/components');
const useBoard = require('./useBoard');
const useContinueWatchingPreview = require('./useContinueWatchingPreview');
const useDownloadRecords = require('stremio/customStremio/useDownloadRecords');
const usePlaybackProgress = require('stremio/customStremio/usePlaybackProgress');
const { getBackendSettings } = require('stremio/customStremio/localBackendClient');
const { mergeLocalContinueWatching } = require('stremio/customStremio/continueWatchingPresentation');
const styles = require('./styles');
const { default: StreamingServerWarning } = require('./StreamingServerWarning');

const THRESHOLD = 5;

const BoardContinueWatchingItem = ({ customStremioLocal, customStremioDownloadId, onPlayLocal, ...props }) => customStremioLocal ?
    <MetaItem
        {...props}
        onPlayClick={(event) => {
            event.preventDefault();
            onPlayLocal?.(customStremioDownloadId);
        }}
    /> : <ContinueWatchingItem {...props} />;

BoardContinueWatchingItem.propTypes = {
    customStremioLocal: PropTypes.bool,
    customStremioDownloadId: PropTypes.string,
    onPlayLocal: PropTypes.func
};

const Board = () => {
    const t = useTranslate();
    const streamingServer = useStreamingServer();
    const nativeContinueWatchingPreview = useContinueWatchingPreview();
    const [localProgressEnabled, setLocalProgressEnabled] = React.useState(false);
    const { items: downloadRecords, play: playDownload } = useDownloadRecords({ enabled: localProgressEnabled });
    const { records: playbackProgressRecords } = usePlaybackProgress({ enabled: localProgressEnabled });
    React.useEffect(() => {
        let canceled = false;
        getBackendSettings().then((settings) => {
            if (!canceled) {
                setLocalProgressEnabled(settings?.player?.progressTracking?.enabled === true &&
                    settings?.player?.progressTracking?.watchedSyncEnabled === true);
            }
        }).catch(() => undefined);
        return () => {
            canceled = true;
        };
    }, []);
    const continueWatchingPreview = React.useMemo(() => localProgressEnabled ?
        mergeLocalContinueWatching(nativeContinueWatchingPreview, downloadRecords, playbackProgressRecords) :
        nativeContinueWatchingPreview,
    [downloadRecords, localProgressEnabled, nativeContinueWatchingPreview, playbackProgressRecords]);
    const continueWatchingItemComponent = React.useCallback((props) => (
        <BoardContinueWatchingItem {...props} onPlayLocal={playDownload} />
    ), [playDownload]);
    const [board, loadBoardRows] = useBoard();
    const notifications = useNotifications();
    const profile = useProfile();
    const boardCatalogsOffset = continueWatchingPreview.items.length > 0 ? 1 : 0;
    const scrollContainerRef = React.useRef();
    const showStreamingServerWarning = React.useMemo(() => {
        return streamingServer.settings !== null && streamingServer.settings.type === 'Err' && (
            isNaN(profile.settings.streamingServerWarningDismissed.getTime()) ||
            profile.settings.streamingServerWarningDismissed.getTime() < Date.now());
    }, [profile.settings, streamingServer.settings]);
    const onVisibleRangeChange = React.useCallback(() => {
        const range = getVisibleChildrenRange(scrollContainerRef.current);
        if (range === null) {
            return;
        }

        const start = Math.max(0, range.start - boardCatalogsOffset - THRESHOLD);
        const end = range.end - boardCatalogsOffset + THRESHOLD;
        if (end < start) {
            return;
        }

        loadBoardRows({ start, end });
    }, [boardCatalogsOffset]);
    const onScroll = React.useCallback(debounce(onVisibleRangeChange, 250), [onVisibleRangeChange]);
    React.useLayoutEffect(() => {
        onVisibleRangeChange();
    }, [board.catalogs, onVisibleRangeChange]);
    return (
        <div className={styles['board-container']}>
            <EventModal />
            <MainNavBars className={styles['board-content-container']} route={'board'}>
                <div ref={scrollContainerRef} className={styles['board-content']} onScroll={onScroll}>
                    {
                        continueWatchingPreview.items.length > 0 ?
                            <MetaRow
                                className={classnames(styles['board-row'], styles['continue-watching-row'], 'animation-fade-in')}
                                title={t.string('BOARD_CONTINUE_WATCHING')}
                                catalog={continueWatchingPreview}
                                itemComponent={continueWatchingItemComponent}
                                notifications={notifications}
                            />
                            :
                            null
                    }
                    {board.catalogs.map((catalog, index) => {
                        switch (catalog.content?.type) {
                            case 'Ready': {
                                return (
                                    <MetaRow
                                        key={index}
                                        className={classnames(styles['board-row'], styles[`board-row-${catalog.content.content[0].posterShape}`], 'animation-fade-in')}
                                        catalog={catalog}
                                        itemComponent={MetaItem}
                                    />
                                );
                            }
                            case 'Err': {
                                if (catalog.content.content !== 'EmptyContent') {
                                    return (
                                        <MetaRow
                                            key={index}
                                            className={classnames(styles['board-row'], 'animation-fade-in')}
                                            catalog={catalog}
                                            message={catalog.content.content}
                                        />
                                    );
                                }
                                return null;
                            }
                            default: {
                                return (
                                    <MetaRow.Placeholder
                                        key={index}
                                        className={classnames(styles['board-row'], styles['board-row-poster'], 'animation-fade-in')}
                                        catalog={catalog}
                                        title={t.catalogTitle(catalog)}
                                    />
                                );
                            }
                        }
                    })}
                </div>
            </MainNavBars>
            {
                showStreamingServerWarning ?
                    <StreamingServerWarning className={styles['board-warning-container']} />
                    :
                    null
            }
        </div>
    );
};

const BoardFallback = () => (
    <div className={styles['board-container']}>
        <MainNavBars className={styles['board-content-container']} route={'board'} />
    </div>
);

module.exports = withCoreSuspender(Board, BoardFallback);

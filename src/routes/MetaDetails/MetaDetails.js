// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { useTranslation } = require('react-i18next');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useCore } = require('stremio/core');
const { useContentGamepadNavigation } = require('stremio/services/GamepadNavigation');
const { withCoreSuspender } = require('stremio/common');
const useDownloadRecords = require('stremio/customStremio/useDownloadRecords');
const { createDownload } = require('stremio/customStremio/localBackendClient');
const {
    SAFE_BATCH_READINESS,
    createBatchDownloadSession,
    assignBatchDownloadSource,
    removeBatchDownloadAssignment,
    markBatchDownloadAssignmentSubmitted,
    markBatchVerificationAttempt,
    getNextUnassignedBatchEpisode,
    getBatchDownloadAssignments,
    readBatchDownloadSession,
    writeBatchDownloadSession
} = require('stremio/customStremio/batchDownloadSelection');
const { VerticalNavBar, HorizontalNavBar, DelayedRenderer, Image, MetaPreview, ModalDialog } = require('stremio/components');
const StreamsList = require('./StreamsList');
const VideosList = require('./VideosList');
const TitleDownloadsPanel = require('stremio/customStremio/components/TitleDownloadsPanel');
const BatchDownloadWorkspace = require('stremio/customStremio/components/BatchDownloadWorkspace');
const useMetaDetails = require('./useMetaDetails');
const useSeason = require('./useSeason');
const useMetaExtensionTabs = require('./useMetaExtensionTabs');
const styles = require('./styles');

const STREAMS_SIDEBAR_WIDTH_STORAGE_KEY = 'customStremio.streamsSidebarWidth';
const STREAMS_SIDEBAR_MIN_WIDTH = 420;
const STREAMS_SIDEBAR_MAX_WIDTH = 2260;
const STREAMS_SIDEBAR_MIN_MAIN_CONTENT_WIDTH = 50;

const clampSidebarWidth = (width, containerWidth) => {
    const maxWidth = typeof containerWidth === 'number' && !Number.isNaN(containerWidth) ?
        Math.min(STREAMS_SIDEBAR_MAX_WIDTH, Math.max(STREAMS_SIDEBAR_MIN_WIDTH, containerWidth - STREAMS_SIDEBAR_MIN_MAIN_CONTENT_WIDTH))
        :
        STREAMS_SIDEBAR_MAX_WIDTH;

    return Math.min(maxWidth, Math.max(STREAMS_SIDEBAR_MIN_WIDTH, width));
};

const MetaDetails = ({ urlParams, queryParams }) => {
    const contentRef = React.useRef(null);
    const sidebarResizeStateRef = React.useRef(null);
    const { t } = useTranslation();
    const core = useCore();
    const metaDetails = useMetaDetails(urlParams);
    const [streamsSidebarWidth, setStreamsSidebarWidth] = React.useState(() => {
        try {
            if (typeof window === 'undefined' || !window.localStorage) {
                return 480;
            }

            return clampSidebarWidth(Number(window.localStorage.getItem(STREAMS_SIDEBAR_WIDTH_STORAGE_KEY)) || 480);
        } catch {
            return 480;
        }
    });
    const [season, setSeason] = useSeason(urlParams, queryParams);
    const [tabs, metaExtension, clearMetaExtension] = useMetaExtensionTabs(metaDetails.metaExtensions);
    const [metaPath, streamPath] = React.useMemo(() => {
        return metaDetails.selected !== null ?
            [metaDetails.selected.metaPath, metaDetails.selected.streamPath]
            :
            [null, null];
    }, [metaDetails.selected]);
    const video = React.useMemo(() => {
        return streamPath !== null && metaDetails.metaItem !== null && metaDetails.metaItem.content.type === 'Ready' ?
            metaDetails.metaItem.content.content.videos.reduce((result, video) => {
                if (video.id === streamPath.id) {
                    return video;
                }

                return result;
            }, null)
            :
            null;
    }, [metaDetails.metaItem, streamPath]);
    const metaItemContent = React.useMemo(() => {
        return metaDetails.metaItem !== null && metaDetails.metaItem.content.type === 'Ready' ?
            metaDetails.metaItem.content.content
            :
            null;
    }, [metaDetails.metaItem]);
    const titleDownloadsMetaId = metaItemContent?.id ?? null;
    const [batchDownloadSession, setBatchDownloadSession] = React.useState(() => {
        try {
            return readBatchDownloadSession(typeof window === 'undefined' ? null : window.sessionStorage, urlParams.id);
        } catch {
            return null;
        }
    });
    const [batchQueueState, setBatchQueueState] = React.useState(null);
    const [batchAutomationStatus, setBatchAutomationStatus] = React.useState(null);
    const updateBatchDownloadSession = React.useCallback((session) => {
        setBatchDownloadSession(session);
        try {
            writeBatchDownloadSession(typeof window === 'undefined' ? null : window.sessionStorage, session);
        } catch {
            // Keep the current batch working in memory when session storage is unavailable.
        }
    }, []);
    const {
        items: titleDownloadRecords,
        initialLoading: titleDownloadsInitialLoading,
        refreshing: titleDownloadsRefreshing,
        error: titleDownloadsError,
        actionStates: titleDownloadActions,
        actionErrors: titleDownloadActionErrors,
        refresh: loadTitleDownloads,
        onDownloadCreated: handleDownloadCreated,
        pause: handlePauseDownload,
        resume: handleResumeDownload,
        cancel: handleCancelDownload,
        retry: handleRetryDownload,
        play: handlePlayDownload,
        remove: handleRemoveDownloadRecord,
        removeMedia: handleDeleteDownloadMedia
    } = useDownloadRecords({
        metaId: titleDownloadsMetaId,
        enabled: streamPath !== null && Boolean(titleDownloadsMetaId)
    });
    React.useEffect(() => {
        try {
            setBatchDownloadSession(readBatchDownloadSession(typeof window === 'undefined' ? null : window.sessionStorage, urlParams.id));
        } catch {
            setBatchDownloadSession(null);
        }
        setBatchQueueState(null);
        setBatchAutomationStatus(null);
    }, [urlParams.id]);
    React.useEffect(() => {
        if (!batchQueueState?.complete) {
            return undefined;
        }
        const timeoutId = setTimeout(() => setBatchQueueState(null), 5000);
        return () => clearTimeout(timeoutId);
    }, [batchQueueState?.complete]);
    const loadBatchEpisode = React.useCallback((videoId) => {
        core.transport.dispatch({
            action: 'Load',
            args: {
                model: 'MetaDetails',
                args: {
                    metaPath: {
                        resource: 'meta',
                        type: urlParams.type,
                        id: urlParams.id,
                        extra: []
                    },
                    streamPath: typeof videoId === 'string' && videoId ? {
                        resource: 'stream',
                        type: urlParams.type,
                        id: videoId,
                        extra: []
                    } : null,
                    guessStream: true
                }
            }
        }, 'meta_details');
    }, [core, urlParams.id, urlParams.type]);
    const currentBatchEpisode = React.useMemo(() => getNextUnassignedBatchEpisode(batchDownloadSession), [batchDownloadSession]);
    const currentBatchEpisodeIsManual = Boolean(currentBatchEpisode &&
        (batchDownloadSession?.manualSelectionEpisodeIds || []).includes(currentBatchEpisode.id));

    React.useEffect(() => {
        if (batchDownloadSession?.status !== 'collecting' || !currentBatchEpisode) {
            return;
        }
        setBatchAutomationStatus({ stage: currentBatchEpisodeIsManual ? 'manual' : 'preparing' });
        if (streamPath?.id !== currentBatchEpisode.id) {
            loadBatchEpisode(currentBatchEpisode.id);
        }
    }, [batchDownloadSession?.status, currentBatchEpisode, currentBatchEpisodeIsManual, loadBatchEpisode, streamPath?.id]);
    const startBatchDownload = React.useCallback(({ episodes, providerPolicy }) => {
        const session = createBatchDownloadSession({
            metaId: titleDownloadsMetaId,
            parentTitle: metaItemContent?.name,
            episodes,
            providerPolicy
        });
        if (session.episodes.length === 0) {
            return;
        }
        updateBatchDownloadSession(session);
        setBatchQueueState(null);
        setBatchAutomationStatus({ stage: 'preparing' });
        loadBatchEpisode(session.episodes[0].id);
    }, [titleDownloadsMetaId, metaItemContent?.name, updateBatchDownloadSession, loadBatchEpisode]);
    const selectBatchDownloadSource = React.useCallback((candidate) => {
        if (!batchDownloadSession || !video?.id || !candidate?.payload || !SAFE_BATCH_READINESS.has(candidate.readiness)) {
            return;
        }
        const nextSession = assignBatchDownloadSource(batchDownloadSession, video.id, candidate);
        updateBatchDownloadSession(nextSession);
        const nextEpisode = getNextUnassignedBatchEpisode(nextSession);
        if (nextEpisode) {
            setBatchAutomationStatus({ stage: 'preparing' });
            loadBatchEpisode(nextEpisode.id);
        }
    }, [batchDownloadSession, video?.id, updateBatchDownloadSession, loadBatchEpisode]);
    const changeBatchDownloadSource = React.useCallback((videoId) => {
        if (!batchDownloadSession) {
            return;
        }
        const episode = batchDownloadSession.episodes.find(({ id }) => id === videoId);
        if (!episode) {
            return;
        }
        updateBatchDownloadSession(removeBatchDownloadAssignment(batchDownloadSession, videoId));
        setBatchAutomationStatus({ stage: 'manual' });
        loadBatchEpisode(episode.id);
    }, [batchDownloadSession, updateBatchDownloadSession, loadBatchEpisode]);
    const chooseBatchSourceManually = React.useCallback(() => {
        if (!batchDownloadSession || !currentBatchEpisode) {
            return;
        }
        updateBatchDownloadSession({
            ...batchDownloadSession,
            manualSelectionEpisodeIds: Array.from(new Set([
                ...(batchDownloadSession.manualSelectionEpisodeIds || []),
                currentBatchEpisode.id
            ]))
        });
        setBatchAutomationStatus({ stage: 'manual' });
    }, [batchDownloadSession, currentBatchEpisode, updateBatchDownloadSession]);
    const recordBatchVerificationAttempt = React.useCallback((candidate) => {
        if (!batchDownloadSession || !video?.id) {
            return;
        }
        updateBatchDownloadSession(markBatchVerificationAttempt(batchDownloadSession, video.id, candidate));
    }, [batchDownloadSession, updateBatchDownloadSession, video?.id]);
    const cancelBatchDownload = React.useCallback(() => {
        updateBatchDownloadSession(null);
        setBatchQueueState(null);
        setBatchAutomationStatus(null);
        loadBatchEpisode(null);
    }, [updateBatchDownloadSession, loadBatchEpisode]);
    const queueBatchDownloads = React.useCallback(async () => {
        const assignments = getBatchDownloadAssignments(batchDownloadSession)
            .filter(({ assignment }) => !assignment.submitted);
        if (assignments.length === 0 || batchQueueState?.queueing) {
            return;
        }
        setBatchQueueState({ queueing: true, completed: 0, total: assignments.length, errors: [] });
        const errors = [];
        let nextSession = batchDownloadSession;
        for (let index = 0; index < assignments.length; index += 1) {
            const { episode, assignment } = assignments[index];
            try {
                const record = await createDownload(assignment.payload);
                handleDownloadCreated(record);
                nextSession = markBatchDownloadAssignmentSubmitted(nextSession, episode.id, record);
                updateBatchDownloadSession(nextSession);
            } catch (error) {
                errors.push({ episode, message: error?.backendError || error?.message || 'Could not queue this episode.' });
            }
            setBatchQueueState({ queueing: true, completed: index + 1, total: assignments.length, errors: [...errors] });
        }
        const allSubmitted = getBatchDownloadAssignments(nextSession).every(({ assignment }) => assignment.submitted);
        if (errors.length === 0 && allSubmitted) {
            updateBatchDownloadSession(null);
            setBatchQueueState({ queueing: false, completed: assignments.length, total: assignments.length, errors: [], complete: true });
            setBatchAutomationStatus(null);
            loadBatchEpisode(null);
        } else {
            setBatchQueueState({ queueing: false, completed: assignments.length, total: assignments.length, errors });
        }
    }, [batchDownloadSession, batchQueueState?.queueing, handleDownloadCreated, updateBatchDownloadSession, loadBatchEpisode]);
    const addToLibrary = React.useCallback(() => {
        if (metaDetails.metaItem === null || metaDetails.metaItem.content.type !== 'Ready') {
            return;
        }

        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'AddToLibrary',
                args: metaDetails.metaItem.content.content
            }
        });
    }, [metaDetails]);
    const removeFromLibrary = React.useCallback(() => {
        if (metaDetails.metaItem === null || metaDetails.metaItem.content.type !== 'Ready') {
            return;
        }

        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'RemoveFromLibrary',
                args: metaDetails.metaItem.content.content.id
            }
        });
    }, [metaDetails]);
    const toggleWatched = React.useCallback(() => {
        if (metaDetails.metaItem === null || metaDetails.metaItem.content.type !== 'Ready') {
            return;
        }

        core.transport.dispatch({
            action: 'MetaDetails',
            args: {
                action: 'MarkAsWatched',
                args: !metaDetails.metaItem.content.content.watched
            }
        });
    }, [metaDetails]);
    const toggleNotifications = React.useCallback(() => {
        if (metaDetails.libraryItem) {
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'ToggleLibraryItemNotifications',
                    args: [metaDetails.libraryItem._id, !metaDetails.libraryItem.state.noNotif],
                }
            });
        }
    }, [metaDetails.libraryItem]);
    const seasonOnSelect = React.useCallback((event) => {
        setSeason(event.value);
    }, [setSeason]);
    const handleEpisodeSearch = React.useCallback((season, episode) => {
        const searchVideoHash = encodeURIComponent(`${urlParams.id}:${season}:${episode}`);
        const url = window.location.hash;

        const searchVideoPath = (urlParams.videoId === undefined || urlParams.videoId === null || urlParams.videoId === '') ?
            url + (!url.endsWith('/') ? '/' : '') + searchVideoHash
            : url.replace(encodeURIComponent(urlParams.videoId), searchVideoHash);

        window.location = searchVideoPath;
    }, [urlParams, window.location]);
    const stopSidebarResize = React.useCallback(() => {
        sidebarResizeStateRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }, []);
    const handleSidebarResizeMove = React.useCallback((event) => {
        if (sidebarResizeStateRef.current === null) {
            return;
        }

        const { contentLeft, contentWidth } = sidebarResizeStateRef.current;
        const nextWidth = clampSidebarWidth(contentLeft + contentWidth - event.clientX, contentWidth);
        setStreamsSidebarWidth(nextWidth);
    }, []);
    const startSidebarResize = React.useCallback((event) => {
        if (window.matchMedia(`(max-width:  ${767}px)`).matches) {
            return;
        }

        if (!contentRef.current) {
            return;
        }

        const contentBounds = contentRef.current.getBoundingClientRect();
        sidebarResizeStateRef.current = {
            contentLeft: contentBounds.left,
            contentWidth: contentBounds.width
        };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        event.preventDefault();
    }, []);

    React.useEffect(() => {
        window.addEventListener('pointermove', handleSidebarResizeMove);
        window.addEventListener('pointerup', stopSidebarResize);
        window.addEventListener('pointercancel', stopSidebarResize);

        return () => {
            window.removeEventListener('pointermove', handleSidebarResizeMove);
            window.removeEventListener('pointerup', stopSidebarResize);
            window.removeEventListener('pointercancel', stopSidebarResize);
            stopSidebarResize();
        };
    }, [handleSidebarResizeMove, stopSidebarResize]);

    React.useEffect(() => {
        const resizeSidebarToViewport = () => {
            const containerWidth = contentRef.current?.getBoundingClientRect().width || window.innerWidth;
            setStreamsSidebarWidth((currentValue) => clampSidebarWidth(currentValue, containerWidth));
        };

        resizeSidebarToViewport();
        window.addEventListener('resize', resizeSidebarToViewport);

        return () => {
            window.removeEventListener('resize', resizeSidebarToViewport);
        };
    }, []);

    React.useEffect(() => {
        try {
            if (typeof window === 'undefined' || !window.localStorage) {
                return;
            }

            window.localStorage.setItem(STREAMS_SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(streamsSidebarWidth)));
        } catch {
            // Ignore persistence failures and keep the in-memory width.
        }
    }, [streamsSidebarWidth]);
    const renderBackgroundImageFallback = React.useCallback(() => null, []);
    const renderBackground = React.useMemo(() => !!(
        metaPath &&
        metaDetails?.metaItem &&
        metaDetails.metaItem.content.type !== 'Loading' &&
        typeof metaDetails.metaItem.content.content?.background === 'string' &&
        metaDetails.metaItem.content.content.background.length > 0
    ), [metaPath, metaDetails]);

    useContentGamepadNavigation(contentRef, urlParams.path);
    return (
        <div className={styles['metadetails-container']}>
            {
                renderBackground ?
                    <div className={styles['background-image-layer']}>
                        <Image
                            className={styles['background-image']}
                            src={metaDetails.metaItem.content.content.background}
                            renderFallback={renderBackgroundImageFallback}
                            alt={' '}
                        />
                    </div>
                    :
                    null
            }
            <HorizontalNavBar
                className={styles['nav-bar']}
                backButton={true}
                fullscreenButton={true}
                navMenu={true}
            />
            <div ref={contentRef} className={styles['metadetails-content']}>
                {
                    tabs.length > 0 ?
                        <VerticalNavBar
                            className={styles['vertical-nav-bar']}
                            tabs={tabs}
                            selected={metaExtension !== null ? metaExtension.url : null}
                        />
                        :
                        null
                }
                {
                    metaPath === null ?
                        <DelayedRenderer delay={500}>
                            <div className={styles['meta-message-container']}>
                                <Image className={styles['image']} src={require('/assets/images/empty.png')} alt={' '} />
                                <div className={styles['message-label']}>{t('ERR_NO_META_SELECTED')}</div>
                            </div>
                        </DelayedRenderer>
                        :
                        metaDetails.metaItem === null ?
                            <div className={styles['meta-message-container']}>
                                <Image className={styles['image']} src={require('/assets/images/empty.png')} alt={' '} />
                                <div className={styles['message-label']}>{t('ERR_NO_ADDONS_FOR_META')}</div>
                            </div>
                            :
                            metaDetails.metaItem.content.type === 'Err' ?
                                <div className={styles['meta-message-container']}>
                                    <Image className={styles['image']} src={require('/assets/images/empty.png')} alt={' '} />
                                    <div className={styles['message-label']}>{t('ERR_NO_META_FOUND')}</div>
                                </div>
                                :
                                metaDetails.metaItem.content.type === 'Loading' ?
                                    <MetaPreview.Placeholder className={styles['meta-preview']} />
                                    :
                                    <React.Fragment>
                                        <MetaPreview
                                            className={classnames(styles['meta-preview'], 'animation-fade-in')}
                                            name={metaDetails.metaItem.content.content.name}
                                            logo={metaDetails.metaItem.content.content.logo}
                                            runtime={metaDetails.metaItem.content.content.runtime}
                                            releaseInfo={metaDetails.metaItem.content.content.releaseInfo}
                                            released={metaDetails.metaItem.content.content.released}
                                            description={
                                                video !== null && typeof video.overview === 'string' && video.overview.length > 0 ?
                                                    video.overview
                                                    :
                                                    metaDetails.metaItem.content.content.description
                                            }
                                            links={metaDetails.metaItem.content.content.links}
                                            trailerStreams={metaDetails.metaItem.content.content.trailerStreams}
                                            inLibrary={metaDetails.metaItem.content.content.inLibrary}
                                            toggleInLibrary={metaDetails.metaItem.content.content.inLibrary ? removeFromLibrary : addToLibrary}
                                            watched={metaDetails.metaItem.content.content.watched}
                                            toggleWatched={toggleWatched}
                                            metaId={metaDetails.metaItem.content.content.id}
                                            ratingInfo={metaDetails.ratingInfo}
                                            footerContent={
                                                streamPath !== null ?
                                                    (
                                                        <TitleDownloadsPanel
                                                            metaId={titleDownloadsMetaId}
                                                            items={titleDownloadRecords}
                                                            initialLoading={titleDownloadsInitialLoading}
                                                            refreshing={titleDownloadsRefreshing}
                                                            error={titleDownloadsError}
                                                            actionStates={titleDownloadActions}
                                                            actionErrors={titleDownloadActionErrors}
                                                            onRefresh={loadTitleDownloads}
                                                            onPause={handlePauseDownload}
                                                            onResume={handleResumeDownload}
                                                            onCancel={handleCancelDownload}
                                                            onRetry={handleRetryDownload}
                                                            onPlay={handlePlayDownload}
                                                            onRemove={handleRemoveDownloadRecord}
                                                            onDeleteMedia={handleDeleteDownloadMedia}
                                                        />
                                                    )
                                                    :
                                                    null
                                            }
                                        />
                                    </React.Fragment>
                }
                <div className={styles['spacing']} />
                {
                    streamPath !== null ?
                        <div className={styles['streams-list-shell']} style={{ width: `${streamsSidebarWidth}px` }}>
                            <div
                                className={styles['streams-list-resize-handle']}
                                onPointerDown={startSidebarResize}
                                title={'Resize stream sidebar'}
                                role={'separator'}
                                aria-orientation={'vertical'}
                                aria-label={'Resize stream sidebar'}
                            />
                            <StreamsList
                                className={styles['streams-list']}
                                metaId={titleDownloadsMetaId}
                                parentTitle={metaItemContent?.name ?? video?.title ?? null}
                                poster={metaItemContent?.poster ?? null}
                                background={metaItemContent?.background ?? null}
                                mediaMetadata={metaItemContent}
                                streams={metaDetails.streams}
                                downloadRecords={titleDownloadRecords}
                                downloadActionStates={titleDownloadActions}
                                downloadActionErrors={titleDownloadActionErrors}
                                video={video}
                                type={streamPath.type}
                                onEpisodeSearch={handleEpisodeSearch}
                                onDownloadCreated={handleDownloadCreated}
                                onPlayDownload={handlePlayDownload}
                                batchDownloadSession={batchDownloadSession}
                                onSelectBatchDownloadSource={selectBatchDownloadSource}
                                onRecordBatchVerificationAttempt={recordBatchVerificationAttempt}
                                onBatchAutomationStatusChange={setBatchAutomationStatus}
                                onCancelBatchDownload={cancelBatchDownload}
                            />
                        </div>
                        :
                        metaPath !== null ?
                            <div className={styles['streams-list-shell']} style={{ width: `${streamsSidebarWidth}px` }}>
                                <div
                                    className={styles['streams-list-resize-handle']}
                                    onPointerDown={startSidebarResize}
                                    title={'Resize episode sidebar'}
                                    role={'separator'}
                                    aria-orientation={'vertical'}
                                    aria-label={'Resize episode sidebar'}
                                />
                                <VideosList
                                    className={styles['videos-list']}
                                    metaItem={metaDetails.metaItem}
                                    libraryItem={metaDetails.libraryItem}
                                    season={season}
                                    selectedVideoId={metaDetails.libraryItem?.state?.video_id}
                                    seasonOnSelect={seasonOnSelect}
                                    toggleNotifications={toggleNotifications}
                                    batchDownloadSession={batchDownloadSession}
                                    onStartBatchDownload={startBatchDownload}
                                    onCancelBatchDownload={cancelBatchDownload}
                                />
                            </div>
                            :
                            null
                }
            </div>
            {
                batchDownloadSession && !currentBatchEpisodeIsManual ?
                    <BatchDownloadWorkspace
                        parentTitle={metaItemContent?.name || batchDownloadSession.parentTitle}
                        poster={metaItemContent?.poster || null}
                        session={batchDownloadSession}
                        currentEpisode={currentBatchEpisode}
                        automationStatus={batchAutomationStatus}
                        queueState={batchQueueState}
                        onChangeSource={changeBatchDownloadSource}
                        onChooseManually={chooseBatchSourceManually}
                        onQueue={queueBatchDownloads}
                        onCancel={cancelBatchDownload}
                    />
                    : null
            }
            {
                batchQueueState?.complete ?
                    <div className={styles['batch-queue-success']} role={'status'}>
                        {t('CUSTOM_BATCH_QUEUED_SUCCESS', {
                            defaultValue: '{{count}} episodes added to the download queue.',
                            count: batchQueueState.total
                        })}
                    </div>
                    : null
            }
            {
                metaExtension !== null ?
                    <ModalDialog
                        className={styles['meta-extension-modal-container']}
                        title={metaExtension.name}
                        onCloseRequest={clearMetaExtension}>
                        <iframe
                            className={styles['meta-extension-modal-iframe']}
                            sandbox={'allow-forms allow-scripts allow-same-origin'}
                            src={metaExtension.url}
                        />
                    </ModalDialog>
                    :
                    null
            }
        </div>
    );
};

MetaDetails.propTypes = {
    urlParams: PropTypes.shape({
        path: PropTypes.string,
        type: PropTypes.string,
        id: PropTypes.string,
        videoId: PropTypes.string
    }),
    queryParams: PropTypes.instanceOf(URLSearchParams)
};

const MetaDetailsFallback = () => (
    <div className={styles['metadetails-container']}>
        <HorizontalNavBar
            className={styles['nav-bar']}
            backButton={true}
            fullscreenButton={true}
            navMenu={true}
        />
    </div>
);

module.exports = withCoreSuspender(MetaDetails, MetaDetailsFallback);

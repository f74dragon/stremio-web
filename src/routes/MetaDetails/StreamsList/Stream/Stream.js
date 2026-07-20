// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { t } = require('i18next');
const { useCore } = require('stremio/core');
const { useProfile, usePlatform, useToast, useBinaryState } = require('stremio/common');
const { Button, Image, Popup } = require('stremio/components');
const { useRouteFocused } = require('stremio-router');
const StreamPlaceholder = require('./StreamPlaceholder');
const styles = require('./styles');
const {
    DEBRID_PROVIDER,
    SOURCE_READINESS,
    isSourceReadinessBlocked
} = require('stremio/customStremio/debridSourceReadiness');

const getDownloadButtonLabel = (downloadRecord, isDownloadPending, downloadAction, sourceReadiness) => {
    if (isDownloadPending) {
        return 'Adding...';
    }

    if (downloadAction === 'play') {
        return 'Opening...';
    }

    switch (downloadRecord?.status) {
        case 'queued':
            return 'Queued';
        case 'downloading':
            return 'Downloading';
        case 'paused':
            return 'Paused';
        case 'completed':
            return 'Play Download';
        default:
            if (sourceReadiness === SOURCE_READINESS.REQUIRES_CACHING) {
                return 'Not cached';
            }
            return sourceReadiness === SOURCE_READINESS.UNAVAILABLE ? 'Unavailable' : 'Download';
    }
};

const getBlockedSourceMessage = (provider, sourceReadiness) => {
    const providerName = provider === DEBRID_PROVIDER.REALDEBRID ? 'Real-Debrid' :
        provider === DEBRID_PROVIDER.ALLDEBRID ? 'AllDebrid' : 'debrid provider';
    return sourceReadiness === SOURCE_READINESS.UNAVAILABLE ?
        `This source is unavailable on ${providerName}. Choose a cached source instead.`
        :
        `This source is not cached on ${providerName}. Choose a cached source instead.`;
};

const Stream = ({
    className,
    videoId,
    videoReleased,
    addonName,
    debridProvider = DEBRID_PROVIDER.UNKNOWN,
    name,
    description,
    thumbnail,
    progress,
    deepLinks,
    downloadPayload,
    downloadRecord,
    downloadAction,
    downloadActionError,
    sourceReadiness = SOURCE_READINESS.UNKNOWN,
    availabilityVerifiedAt,
    realDebridAvailability,
    isAvailabilityChecking = false,
    availabilityCheckStage = 'cache',
    availabilityCheckError,
    isDownloadPending,
    onDownloadPlaceholder,
    onPlayDownload,
    ...props
}) => {
    const profile = useProfile();
    const toast = useToast();
    const platform = usePlatform();
    const core = useCore();
    const routeFocused = useRouteFocused();

    const [menuOpen, , closeMenu, toggleMenu] = useBinaryState(false);

    const popupLabelOnMouseUp = React.useCallback((event) => {
        if (!event.nativeEvent.togglePopupPrevented) {
            if (event.nativeEvent.ctrlKey || event.nativeEvent.button === 2) {
                event.preventDefault();
                toggleMenu();
            }
        }
    }, []);
    const popupLabelOnContextMenu = React.useCallback((event) => {
        if (!event.nativeEvent.togglePopupPrevented && !event.nativeEvent.ctrlKey) {
            event.preventDefault();
        }
    }, [toggleMenu]);
    const popupLabelOnLongPress = React.useCallback((event) => {
        if (event.nativeEvent.pointerType !== 'mouse' && !event.nativeEvent.togglePopupPrevented) {
            toggleMenu();
        }
    }, [toggleMenu]);
    const popupMenuOnPointerDown = React.useCallback((event) => {
        event.nativeEvent.togglePopupPrevented = true;
    }, []);
    const popupMenuOnContextMenu = React.useCallback((event) => {
        event.nativeEvent.togglePopupPrevented = true;
    }, []);
    const popupMenuOnClick = React.useCallback((event) => {
        event.nativeEvent.togglePopupPrevented = true;
    }, []);
    const popupMenuOnKeyDown = React.useCallback((event) => {
        event.nativeEvent.buttonClickPrevented = true;
    }, []);

    const href = React.useMemo(() => {
        if (isSourceReadinessBlocked(sourceReadiness)) {
            return null;
        }

        return deepLinks ?
            deepLinks.externalPlayer ?
                deepLinks.externalPlayer.web ?
                    deepLinks.externalPlayer.web
                    :
                    deepLinks.externalPlayer.openPlayer ?
                        deepLinks.externalPlayer.openPlayer[platform.name] ?
                            deepLinks.externalPlayer.openPlayer[platform.name]
                            :
                            deepLinks.externalPlayer.playlist
                        :
                        deepLinks.player
                :
                deepLinks.player
            :
            null;
    }, [deepLinks, sourceReadiness]);

    const download = React.useMemo(() => {
        return href === deepLinks?.externalPlayer?.playlist ?
            deepLinks.externalPlayer.fileName
            :
            null;
    }, [href, deepLinks]);

    const target = React.useMemo(() => {
        return href === deepLinks?.externalPlayer?.web ?
            '_blank'
            :
            null;
    }, [href, deepLinks]);

    const streamLink = React.useMemo(() => {
        return deepLinks?.externalPlayer?.streaming;
    }, [deepLinks]);

    const downloadLink = React.useMemo(() => {
        return deepLinks?.externalPlayer?.download;
    }, [deepLinks]);

    const magnetLink = React.useMemo(() => {
        return deepLinks?.externalPlayer?.magnet;
    }, [deepLinks]);

    const markVideoAsWatched = React.useCallback(() => {
        if (typeof videoId === 'string') {
            core.transport.dispatch({
                action: 'MetaDetails',
                args: {
                    action: 'MarkVideoAsWatched',
                    args: [{ id: videoId, released: videoReleased }, true]
                }
            });
        }
    }, [videoId, videoReleased]);

    const onClick = React.useCallback((event) => {
        if (event.nativeEvent.togglePopupPrevented) {
            return;
        }

        if (isSourceReadinessBlocked(sourceReadiness)) {
            event.preventDefault();
            toast.show({
                type: 'error',
                title: getBlockedSourceMessage(debridProvider, sourceReadiness),
                timeout: 5000
            });
            return;
        }

        if (profile.settings.playerType !== null) {
            markVideoAsWatched();
            toast.show({
                type: 'success',
                title: 'Stream opened in external player',
                timeout: 4000
            });
        }

        if (typeof props.onClick === 'function') {
            props.onClick(event);
        }
    }, [props.onClick, profile.settings, markVideoAsWatched, debridProvider, sourceReadiness]);

    const copyMagnetLink = React.useCallback((event) => {
        event.preventDefault();
        closeMenu();
        if (magnetLink) {
            navigator.clipboard.writeText(magnetLink)
                .then(() => {
                    toast.show({
                        type: 'success',
                        title: t('PLAYER_COPY_MAGNET_LINK_SUCCESS'),
                        timeout: 4000
                    });
                })
                .catch(() => {
                    toast.show({
                        type: 'error',
                        title: t('PLAYER_COPY_MAGNET_LINK_ERROR'),
                        timeout: 4000,
                    });
                });
        }
    }, [magnetLink]);

    const copyDownloadLink = React.useCallback((event) => {
        event.preventDefault();
        closeMenu();
        if (downloadLink) {
            navigator.clipboard.writeText(downloadLink)
                .then(() => {
                    toast.show({
                        type: 'success',
                        title: t('PLAYER_COPY_DOWNLOAD_LINK_SUCCESS'),
                        timeout: 4000
                    });
                })
                .catch(() => {
                    toast.show({
                        type: 'error',
                        title: t('PLAYER_COPY_DOWNLOAD_LINK_ERROR'),
                        timeout: 4000,
                    });
                });
        }
    }, [downloadLink]);

    const copyStreamLink = React.useCallback((event) => {
        event.preventDefault();
        closeMenu();
        if (streamLink) {
            navigator.clipboard.writeText(streamLink)
                .then(() => {
                    toast.show({
                        type: 'success',
                        title: t('PLAYER_COPY_STREAM_SUCCESS'),
                        timeout: 4000
                    });
                })
                .catch(() => {
                    toast.show({
                        type: 'error',
                        title: t('PLAYER_COPY_STREAM_ERROR'),
                        timeout: 4000,
                    });
                });
        }
    }, [streamLink]);
    const downloadButtonOnClick = React.useCallback((event) => {
        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.togglePopupPrevented = true;
        event.nativeEvent.buttonClickPrevented = true;

        if (downloadRecord?.status === 'completed' && downloadRecord.id && !downloadAction && typeof onPlayDownload === 'function') {
            onPlayDownload(downloadRecord.id);
        } else if (!downloadRecord && !isDownloadPending && typeof onDownloadPlaceholder === 'function') {
            onDownloadPlaceholder(downloadPayload);
        }
    }, [downloadPayload, downloadRecord, downloadAction, isDownloadPending, onDownloadPlaceholder, onPlayDownload]);

    const downloadButtonLabel = React.useMemo(
        () => isAvailabilityChecking ? 'Checking availability...' : getDownloadButtonLabel(downloadRecord, isDownloadPending, downloadAction, sourceReadiness),
        [downloadRecord, isDownloadPending, downloadAction, sourceReadiness, isAvailabilityChecking]
    );
    const downloadButtonIsPlayable = downloadRecord?.status === 'completed' && Boolean(downloadRecord.id);
    const hasNonPlayableDownloadRecord = Boolean(downloadRecord) && !downloadButtonIsPlayable;
    const sourceIsBlocked = isSourceReadinessBlocked(sourceReadiness) && !downloadButtonIsPlayable;
    const downloadButtonDisabled = isAvailabilityChecking || isDownloadPending || Boolean(downloadAction) || hasNonPlayableDownloadRecord || sourceIsBlocked;
    const showAllDebridCached = !isAvailabilityChecking && debridProvider === DEBRID_PROVIDER.ALLDEBRID && sourceReadiness === SOURCE_READINESS.CACHED && !downloadButtonIsPlayable;
    const showAllDebridPreviouslyCached = !isAvailabilityChecking && debridProvider === DEBRID_PROVIDER.ALLDEBRID && sourceReadiness === SOURCE_READINESS.PREVIOUSLY_CACHED && !downloadButtonIsPlayable;
    const showAllDebridRequiresCaching = !isAvailabilityChecking && debridProvider === DEBRID_PROVIDER.ALLDEBRID && sourceReadiness === SOURCE_READINESS.REQUIRES_CACHING && !downloadButtonIsPlayable;
    const showAllDebridUnavailable = !isAvailabilityChecking && debridProvider === DEBRID_PROVIDER.ALLDEBRID && sourceReadiness === SOURCE_READINESS.UNAVAILABLE && !downloadButtonIsPlayable;
    const showRealDebridCached = !isAvailabilityChecking && debridProvider === DEBRID_PROVIDER.REALDEBRID && sourceReadiness === SOURCE_READINESS.CACHED && !downloadButtonIsPlayable;
    const showRealDebridReady = !isAvailabilityChecking && debridProvider === DEBRID_PROVIDER.REALDEBRID && sourceReadiness === SOURCE_READINESS.READY && !downloadButtonIsPlayable;
    const showRealDebridPreviouslyCached = !isAvailabilityChecking && debridProvider === DEBRID_PROVIDER.REALDEBRID && sourceReadiness === SOURCE_READINESS.PREVIOUSLY_CACHED && !downloadButtonIsPlayable;
    const showRealDebridUncached = !isAvailabilityChecking && debridProvider === DEBRID_PROVIDER.REALDEBRID && sourceReadiness === SOURCE_READINESS.REQUIRES_CACHING && !downloadButtonIsPlayable;
    const showRealDebridUnavailable = !isAvailabilityChecking && debridProvider === DEBRID_PROVIDER.REALDEBRID && sourceReadiness === SOURCE_READINESS.UNAVAILABLE && !downloadButtonIsPlayable;

    const renderThumbnailFallback = React.useCallback(() => (
        <Icon className={styles['placeholder-icon']} name={'ic_broken_link'} />
    ), []);

    const renderLabel = React.useMemo(() => function renderLabel({ className, children, ...props }) {
        return (
            <Button
                {...props}
                className={classnames(
                    className,
                    styles['stream-container'],
                    sourceIsBlocked ? styles['stream-container-not-ready'] : null
                )}
                title={sourceIsBlocked ? getBlockedSourceMessage(debridProvider, sourceReadiness) : addonName}
                href={href}
                target={target}
                download={download}
                aria-disabled={sourceIsBlocked}
                onClick={onClick}
            >
                <div className={styles['info-container']}>
                    {
                        typeof thumbnail === 'string' && thumbnail.length > 0 ?
                            <div className={styles['thumbnail-container']} title={name || addonName}>
                                <Image
                                    className={styles['thumbnail']}
                                    src={thumbnail}
                                    alt={' '}
                                    renderFallback={renderThumbnailFallback}
                                />
                            </div>
                            :
                            <div className={styles['addon-name-container']} title={name || addonName}>
                                <div className={styles['addon-name']}>{name || addonName}</div>
                            </div>
                    }
                    {
                        progress !== null && !isNaN(progress) && progress > 0 ?
                            <div className={styles['progress-bar-container']}>
                                <div className={styles['progress-bar']} style={{ width: `${progress}%` }} />
                                <div className={styles['progress-bar-background']} />
                            </div>
                            :
                            null
                    }
                </div>
                <div className={styles['description-container']} title={description}>
                    {
                        isAvailabilityChecking ?
                            <div className={classnames(styles['debrid-badge'], styles['debrid-badge-checking'])}>
                                <span className={styles['debrid-badge-checking-dot']} />
                                <span>{availabilityCheckStage === 'resolver' ?
                                    'Checking resolver link...'
                                    : debridProvider === DEBRID_PROVIDER.REALDEBRID ? 'Checking Real-Debrid...' : 'Checking AllDebrid...'}</span>
                            </div>
                            : availabilityCheckError ?
                                <div className={classnames(styles['debrid-badge'], styles['debrid-badge-unresolved'])} title={availabilityCheckError}>
                                    <Icon className={styles['debrid-badge-icon']} name={'warning'} />
                                    <span>{t('CUSTOM_STREAM_AVAILABILITY_UNRESOLVED', { defaultValue: 'Could not safely check' })}</span>
                                </div>
                                : null
                    }
                    {
                        showAllDebridCached ?
                            <div
                                className={styles['debrid-badge']}
                                title={t('CUSTOM_STREAM_ALLDEBRID_CACHED_TITLE', { defaultValue: 'This torrent is already cached by AllDebrid' })}
                            >
                                <Icon className={styles['debrid-badge-icon']} name={'checkmark'} />
                                <span>{t('CUSTOM_STREAM_ALLDEBRID_CACHED', { defaultValue: 'Cached on AllDebrid' })}</span>
                            </div>
                            : null
                    }
                    {
                        showAllDebridPreviouslyCached ?
                            <div
                                className={classnames(styles['debrid-badge'], styles['debrid-badge-previously-cached'])}
                                title={availabilityVerifiedAt ? `Last verified ${new Date(availabilityVerifiedAt).toLocaleString()}` : 'Previously verified in the AllDebrid cache'}
                            >
                                <Icon className={styles['debrid-badge-icon']} name={'checkmark'} />
                                <span>{t('CUSTOM_STREAM_ALLDEBRID_PREVIOUSLY_CACHED', { defaultValue: 'Previously verified cached' })}</span>
                            </div>
                            : null
                    }
                    {
                        showAllDebridRequiresCaching ?
                            <div
                                className={classnames(styles['debrid-badge'], styles['debrid-badge-not-ready'])}
                                title={'This source would ask AllDebrid to cache the torrent before it can play'}
                            >
                                <Icon className={styles['debrid-badge-icon']} name={'warning'} />
                                <span>{t('CUSTOM_STREAM_ALLDEBRID_REQUIRES_CACHING', { defaultValue: 'Requires caching' })}</span>
                            </div>
                            : null
                    }
                    {
                        showAllDebridUnavailable ?
                            <div className={classnames(styles['debrid-badge'], styles['realdebrid-badge-unavailable'])} title={'This AllDebrid source failed and is no longer considered downloadable'}>
                                <Icon className={styles['debrid-badge-icon']} name={'warning'} />
                                <span>{t('CUSTOM_STREAM_ALLDEBRID_UNAVAILABLE', { defaultValue: 'Unavailable on AllDebrid' })}</span>
                            </div>
                            : null
                    }
                    {
                        showRealDebridCached ?
                            <div
                                className={classnames(styles['debrid-badge'], styles['realdebrid-badge'])}
                                title={t('CUSTOM_STREAM_REALDEBRID_CACHED_TITLE', { defaultValue: 'This exact file was verified instantly available on Real-Debrid' })}
                            >
                                <Icon className={styles['debrid-badge-icon']} name={'checkmark'} />
                                <span>{t('CUSTOM_STREAM_REALDEBRID_CACHED', { defaultValue: 'Cached on Real-Debrid' })}</span>
                            </div>
                            : null
                    }
                    {
                        showRealDebridReady ?
                            <div
                                className={classnames(styles['debrid-badge'], styles['realdebrid-badge-ready'])}
                                title={t('CUSTOM_STREAM_REALDEBRID_READY_TITLE', { defaultValue: 'The resolver link returned valid media headers without downloading the file body' })}
                            >
                                <Icon className={styles['debrid-badge-icon']} name={'checkmark'} />
                                <span>{t('CUSTOM_STREAM_REALDEBRID_READY', { defaultValue: 'Ready to download' })}</span>
                            </div>
                            : null
                    }
                    {
                        showRealDebridPreviouslyCached ?
                            <div
                                className={classnames(styles['debrid-badge'], styles['realdebrid-badge'], styles['debrid-badge-previously-cached'])}
                                title={realDebridAvailability?.verifiedAt ? `Last verified ${new Date(realDebridAvailability.verifiedAt).toLocaleString()}` : 'Previously verified on Real-Debrid'}
                            >
                                <Icon className={styles['debrid-badge-icon']} name={'checkmark'} />
                                <span>{t('CUSTOM_STREAM_REALDEBRID_PREVIOUSLY_CACHED', { defaultValue: 'Previously cached on Real-Debrid' })}</span>
                            </div>
                            : null
                    }
                    {
                        showRealDebridUncached ?
                            <div className={classnames(styles['debrid-badge'], styles['realdebrid-badge-not-ready'])} title={'This exact file was not instantly available on Real-Debrid'}>
                                <Icon className={styles['debrid-badge-icon']} name={'warning'} />
                                <span>{t('CUSTOM_STREAM_REALDEBRID_NOT_CACHED', { defaultValue: 'Not cached on Real-Debrid' })}</span>
                            </div>
                            : null
                    }
                    {
                        showRealDebridUnavailable ?
                            <div className={classnames(styles['debrid-badge'], styles['realdebrid-badge-unavailable'])} title={'Real-Debrid rejected this torrent before creating an account entry'}>
                                <Icon className={styles['debrid-badge-icon']} name={'warning'} />
                                <span>{t('CUSTOM_STREAM_REALDEBRID_UNAVAILABLE', { defaultValue: 'Unavailable on Real-Debrid' })}</span>
                            </div>
                            : null
                    }
                    <div className={styles['description-text']}>{description}</div>
                </div>
                <Button
                    className={classnames(
                        styles['download-button-container'],
                        downloadButtonDisabled ? styles['download-button-disabled'] : null,
                        downloadButtonIsPlayable ? styles['download-button-playable'] : null,
                        downloadRecord?.status ? styles[`download-button-${downloadRecord.status}`] : null
                    )}
                    title={downloadButtonLabel}
                    aria-label={downloadButtonLabel}
                    aria-busy={downloadAction === 'play'}
                    aria-disabled={downloadButtonDisabled}
                    disabled={downloadButtonDisabled}
                    tabIndex={-1}
                    onClick={downloadButtonOnClick}
                >
                    <Icon className={styles['download-icon']} name={downloadButtonIsPlayable ? 'play' : 'download'} />
                    <div className={styles['download-label']}>{downloadButtonLabel}</div>
                </Button>
                {
                    downloadActionError ?
                        <div className={styles['download-action-error']} role={'alert'}>{downloadActionError}</div>
                        :
                        null
                }
                <Icon className={styles['icon']} name={sourceIsBlocked ? 'warning' : 'play'} />
                {children}
            </Button>
        );
    }, [thumbnail, progress, addonName, name, description, href, target, download, onClick, downloadButtonOnClick, downloadButtonDisabled, downloadButtonIsPlayable, downloadButtonLabel, downloadAction, downloadActionError, showAllDebridCached, showAllDebridPreviouslyCached, showAllDebridRequiresCaching, showAllDebridUnavailable, showRealDebridCached, showRealDebridReady, showRealDebridPreviouslyCached, showRealDebridUncached, showRealDebridUnavailable, sourceIsBlocked, sourceReadiness, debridProvider, availabilityVerifiedAt, realDebridAvailability, isAvailabilityChecking, availabilityCheckStage, availabilityCheckError]);

    const renderMenu = React.useMemo(() => function renderMenu() {
        return (
            <div className={styles['context-menu-content']} onPointerDown={popupMenuOnPointerDown} onContextMenu={popupMenuOnContextMenu} onClick={popupMenuOnClick} onKeyDown={popupMenuOnKeyDown}>
                <div className={styles['context-menu-title']}>
                    {description}
                </div>
                <Button className={styles['context-menu-option-container']} title={t('CTX_PLAY')}>
                    <Icon className={styles['menu-icon']} name={'play'} />
                    <div className={styles['context-menu-option-label']}>{t('CTX_PLAY')}</div>
                </Button>
                {
                    streamLink &&
                        <Button className={styles['context-menu-option-container']} title={t('CTX_COPY_STREAM_LINK')} onClick={copyStreamLink}>
                            <Icon className={styles['menu-icon']} name={'link'} />
                            <div className={styles['context-menu-option-label']}>{t('CTX_COPY_STREAM_LINK')}</div>
                        </Button>
                }
                {
                    magnetLink &&
                        <Button className={styles['context-menu-option-container']} title={t('CTX_COPY_MAGNET_LINK')} onClick={copyMagnetLink}>
                            <Icon className={styles['menu-icon']} name={'magnet-link'} />
                            <div className={styles['context-menu-option-label']}>{t('CTX_COPY_MAGNET_LINK')}</div>
                        </Button>
                }
                {
                    downloadLink &&
                        <Button className={styles['context-menu-option-container']} title={t('CTX_DOWNLOAD_VIDEO')} onClick={copyDownloadLink}>
                            <Icon className={styles['menu-icon']} name={'download'} />
                            <div className={styles['context-menu-option-label']}>{t('CTX_COPY_VIDEO_DOWNLOAD_LINK')}</div>
                        </Button>
                }
            </div>
        );
    }, [copyStreamLink, onClick]);

    React.useEffect(() => {
        if (!routeFocused) {
            closeMenu();
        }
    }, [routeFocused]);

    return (
        <Popup
            className={className}
            onMouseUp={popupLabelOnMouseUp}
            onLongPress={popupLabelOnLongPress}
            onContextMenu={popupLabelOnContextMenu}
            open={menuOpen}
            onCloseRequest={closeMenu}
            renderLabel={renderLabel}
            renderMenu={renderMenu}
        />
    );
};

Stream.Placeholder = StreamPlaceholder;

Stream.propTypes = {
    className: PropTypes.string,
    videoId: PropTypes.string,
    videoReleased: PropTypes.instanceOf(Date),
    addonName: PropTypes.string,
    debridProvider: PropTypes.oneOf(Object.values(DEBRID_PROVIDER)),
    name: PropTypes.string,
    description: PropTypes.string,
    thumbnail: PropTypes.string,
    progress: PropTypes.number,
    deepLinks: PropTypes.shape({
        player: PropTypes.string,
        externalPlayer: PropTypes.shape({
            download: PropTypes.string,
            magnet: PropTypes.string,
            streaming: PropTypes.string,
            playlist: PropTypes.string,
            fileName: PropTypes.string,
            web: PropTypes.string,
            openPlayer: PropTypes.shape({
                ios: PropTypes.string,
                android: PropTypes.string,
                windows: PropTypes.string,
                macos: PropTypes.string,
                linux: PropTypes.string,
            })
        })
    }),
    downloadPayload: PropTypes.object,
    downloadRecord: PropTypes.object,
    downloadAction: PropTypes.oneOf(['cancel', 'play', 'remove', 'deleteMedia']),
    downloadActionError: PropTypes.string,
    sourceReadiness: PropTypes.oneOf(Object.values(SOURCE_READINESS)),
    availabilityVerifiedAt: PropTypes.string,
    realDebridAvailability: PropTypes.shape({
        status: PropTypes.oneOf(['cached', 'ready', 'uncached', 'unavailable', 'unknown', 'invalid', 'error']),
        verifiedAt: PropTypes.string,
        previouslyVerified: PropTypes.bool
    }),
    isAvailabilityChecking: PropTypes.bool,
    availabilityCheckStage: PropTypes.oneOf(['cache', 'resolver']),
    availabilityCheckError: PropTypes.string,
    isDownloadPending: PropTypes.bool,
    onDownloadPlaceholder: PropTypes.func,
    onPlayDownload: PropTypes.func,
    onClick: PropTypes.func
};

module.exports = Stream;

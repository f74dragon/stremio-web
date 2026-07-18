// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useTranslation } = require('react-i18next');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { Button, Image, MultiselectMenu } = require('stremio/components');
const { useCore } = require('stremio/core');
const Stream = require('./Stream');
const styles = require('./styles');
const { usePlatform, useProfile } = require('stremio/common');
const { default: SeasonEpisodePicker } = require('../EpisodePicker');
const { buildDownloadPayload } = require('stremio/customStremio/downloadPayload');
const {
    createDownload,
    checkAllDebridAvailability,
    getAllDebridAvailabilityHistory
} = require('stremio/customStremio/localBackendClient');
const { findMatchingDownloadRecord, getPayloadSourceUrl, isActiveDownloadRecord } = require('stremio/customStremio/downloadRecordMatching');
const {
    classifyDebridSourceReadiness,
    getStreamInfoHash,
    getSourceReadinessSortRank
} = require('stremio/customStremio/debridSourceReadiness');

const ALL_ADDONS_KEY = 'ALL';
const PREFERRED_ADDON_STORAGE_KEY = 'customStremio.preferredAddon';

const normalizeAddonName = (value) => String(value ?? '').trim().toLowerCase();

const StreamsList = ({
    className,
    metaId,
    parentTitle,
    poster,
    background,
    mediaMetadata,
    downloadRecords = [],
    downloadActionStates = {},
    downloadActionErrors = {},
    video,
    type,
    onEpisodeSearch,
    onDownloadCreated,
    onPlayDownload,
    ...props
}) => {
    const { t } = useTranslation();
    const core = useCore();
    const platform = usePlatform();
    const profile = useProfile();
    const streamsContainerRef = React.useRef(null);
    const downloadStatusHideTimeoutRef = React.useRef(null);
    const downloadStatusClearTimeoutRef = React.useRef(null);
    const [selectedAddon, setSelectedAddon] = React.useState(ALL_ADDONS_KEY);
    const [downloadStatus, setDownloadStatus] = React.useState(null);
    const [pendingDownloadKeys, setPendingDownloadKeys] = React.useState({});
    const [availabilityByHash, setAvailabilityByHash] = React.useState({});
    const [allDebridConnected, setAllDebridConnected] = React.useState(false);
    const [availabilityChecking, setAvailabilityChecking] = React.useState(false);
    const [availabilityError, setAvailabilityError] = React.useState(null);
    const [preferredAddon, setPreferredAddon] = React.useState(() => {
        try {
            if (typeof window === 'undefined' || !window.localStorage) {
                return '';
            }

            return window.localStorage.getItem(PREFERRED_ADDON_STORAGE_KEY) || '';
        } catch {
            return '';
        }
    });
    const onAddonSelected = React.useCallback((value) => {
        streamsContainerRef.current.scrollTo({ top: 0, left: 0, behavior: platform.name === 'ios' ? 'smooth' : 'instant' });
        setSelectedAddon(value);
    }, [platform]);
    const onPreferredAddonSelected = React.useCallback((value) => {
        setPreferredAddon(value);

        try {
            if (typeof window === 'undefined' || !window.localStorage) {
                return;
            }

            if (value) {
                window.localStorage.setItem(PREFERRED_ADDON_STORAGE_KEY, value);
            } else {
                window.localStorage.removeItem(PREFERRED_ADDON_STORAGE_KEY);
            }
        } catch {
            // Ignore storage errors and keep the in-memory selection.
        }
    }, []);
    const showInstallAddonsButton = React.useMemo(() => {
        return !profile || profile.auth === null || profile.auth?.user?.isNewUser === true && !video?.upcoming;
    }, [profile, video]);
    const backButtonOnClick = React.useCallback(() => {
        if (video.deepLinks && typeof video.deepLinks.metaDetailsVideos === 'string') {
            window.location.replace(video.deepLinks.metaDetailsVideos + (
                typeof video.season === 'number' ?
                    `?${new URLSearchParams({ 'season': video.season })}`
                    :
                    null
            ));
        } else {
            window.history.back();
        }
    }, [video]);
    const countLoadingAddons = React.useMemo(() => {
        return props.streams.filter((stream) => stream.content.type === 'Loading').length;
    }, [props.streams]);
    const streamsByAddon = React.useMemo(() => {
        return props.streams
            .filter((streams) => streams.content.type === 'Ready')
            .reduce((streamsByAddon, streams) => {
                streamsByAddon[streams.addon.transportUrl] = {
                    addon: streams.addon,
                    streams: streams.content.content.map((stream) => ({
                        ...stream,
                        onClick: () => {
                            core.transport.analytics({
                                event: 'StreamClicked',
                                args: {
                                    stream
                                }
                            });
                        },
                        addonName: streams.addon.manifest.name
                    }))
                };

                return streamsByAddon;
            }, {});
    }, [props.streams, core]);
    const isPreferredAddonStream = React.useCallback((stream) => {
        return normalizeAddonName(stream?.addonName) === normalizeAddonName(preferredAddon);
    }, [preferredAddon]);
    const filteredStreams = React.useMemo(() => {
        return selectedAddon === ALL_ADDONS_KEY ?
            Object.values(streamsByAddon).map(({ streams }) => streams).flat(1)
            :
            streamsByAddon[selectedAddon] ?
                streamsByAddon[selectedAddon].streams
                :
                [];
    }, [streamsByAddon, selectedAddon]);
    const filteredInfoHashes = React.useMemo(() => Array.from(new Set(
        filteredStreams.map(getStreamInfoHash).filter(Boolean)
    )), [filteredStreams]);
    const filteredInfoHashesKey = filteredInfoHashes.join(',');
    const applyAvailabilityItems = React.useCallback((items) => {
        if (!Array.isArray(items)) {
            return;
        }
        setAvailabilityByHash((currentItems) => {
            const nextItems = { ...currentItems };
            items.forEach((item) => {
                if (typeof item?.hash === 'string') {
                    nextItems[item.hash.toLowerCase()] = item;
                }
            });
            return nextItems;
        });
    }, []);
    const getStreamAvailability = React.useCallback((stream) => {
        const hash = getStreamInfoHash(stream);
        return hash ? availabilityByHash[hash] || null : null;
    }, [availabilityByHash]);
    const getStreamReadiness = React.useCallback((stream) => {
        return classifyDebridSourceReadiness(stream, getStreamAvailability(stream));
    }, [getStreamAvailability]);

    React.useEffect(() => {
        let canceled = false;
        getAllDebridAvailabilityHistory(filteredInfoHashes)
            .then((result) => {
                if (canceled) {
                    return;
                }
                setAllDebridConnected(result?.connected === true);
                applyAvailabilityItems(result?.items);
                setAvailabilityError(null);
            })
            .catch(() => {
                if (!canceled) {
                    setAllDebridConnected(false);
                }
            });
        return () => {
            canceled = true;
        };
    }, [filteredInfoHashesKey, applyAvailabilityItems]);

    const onCheckAvailability = React.useCallback(async () => {
        if (availabilityChecking || filteredInfoHashes.length === 0) {
            return;
        }
        setAvailabilityChecking(true);
        setAvailabilityError(null);
        try {
            const checked = await checkAllDebridAvailability(filteredInfoHashes);
            setAllDebridConnected(checked?.connected === true);
            const history = await getAllDebridAvailabilityHistory(filteredInfoHashes);
            applyAvailabilityItems(history?.items);
            if (checked?.cleanupWarning) {
                setAvailabilityError(checked.cleanupWarning);
            }
        } catch (error) {
            setAvailabilityError(error?.backendError || error?.message || 'Could not check AllDebrid availability.');
        } finally {
            setAvailabilityChecking(false);
        }
    }, [availabilityChecking, filteredInfoHashesKey, applyAvailabilityItems]);
    const orderedFilteredStreams = React.useMemo(() => {
        return filteredStreams
            .map((stream, index) => ({ stream, index }))
            .sort((left, right) => {
                if (selectedAddon === ALL_ADDONS_KEY && normalizeAddonName(preferredAddon)) {
                    const preferredDifference = Number(isPreferredAddonStream(right.stream)) - Number(isPreferredAddonStream(left.stream));
                    if (preferredDifference !== 0) {
                        return preferredDifference;
                    }
                }

                const readinessDifference = getSourceReadinessSortRank(getStreamReadiness(left.stream)) -
                    getSourceReadinessSortRank(getStreamReadiness(right.stream));
                return readinessDifference !== 0 ? readinessDifference : left.index - right.index;
            })
            .map(({ stream }) => stream);
    }, [filteredStreams, selectedAddon, preferredAddon, isPreferredAddonStream, getStreamReadiness]);
    const selectableOptions = React.useMemo(() => {
        return {
            options: [
                {
                    value: ALL_ADDONS_KEY,
                    label: t('ALL_ADDONS'),
                    title: t('ALL_ADDONS')
                },
                ...Object.keys(streamsByAddon).map((transportUrl) => ({
                    value: transportUrl,
                    label: streamsByAddon[transportUrl].addon.manifest.name,
                    title: streamsByAddon[transportUrl].addon.manifest.name,
                }))
            ],
            value: selectedAddon,
            onSelect: onAddonSelected
        };
    }, [streamsByAddon, selectedAddon, t, onAddonSelected]);
    const preferredAddonOptions = React.useMemo(() => {
        const options = [
            {
                value: '',
                label: 'No preference',
                title: 'No preference'
            }
        ];
        const seen = new Set();

        Object.keys(streamsByAddon).forEach((transportUrl) => {
            const addonName = streamsByAddon[transportUrl].addon.manifest.name;
            const normalizedAddonName = normalizeAddonName(addonName);

            if (!normalizedAddonName || seen.has(normalizedAddonName)) {
                return;
            }

            seen.add(normalizedAddonName);
            options.push({
                value: addonName,
                label: addonName,
                title: addonName
            });
        });

        return {
            options,
            value: preferredAddon,
            title: `Preferred addon: ${preferredAddon || 'No preference'}`,
            onSelect: onPreferredAddonSelected
        };
    }, [streamsByAddon, preferredAddon, onPreferredAddonSelected]);
    const availabilitySummary = React.useMemo(() => {
        return filteredInfoHashes.reduce((summary, hash) => {
            const status = availabilityByHash[hash]?.status;
            if (status === 'cached') {
                summary.cached += 1;
            } else if (status === 'uncached') {
                summary.uncached += 1;
            }
            return summary;
        }, { cached: 0, uncached: 0 });
    }, [filteredInfoHashesKey, availabilityByHash]);
    const showDownloadStatus = React.useCallback((message, tone) => {
        const statusId = Date.now();
        setDownloadStatus({ id: statusId, message, tone, visible: true });

        if (downloadStatusHideTimeoutRef.current !== null) {
            clearTimeout(downloadStatusHideTimeoutRef.current);
        }
        if (downloadStatusClearTimeoutRef.current !== null) {
            clearTimeout(downloadStatusClearTimeoutRef.current);
        }

        downloadStatusHideTimeoutRef.current = setTimeout(() => {
            setDownloadStatus((currentStatus) => {
                if (currentStatus === null || currentStatus.id !== statusId) {
                    return currentStatus;
                }

                return {
                    ...currentStatus,
                    visible: false
                };
            });
            downloadStatusHideTimeoutRef.current = null;
        }, 3200);

        downloadStatusClearTimeoutRef.current = setTimeout(() => {
            setDownloadStatus((currentStatus) => currentStatus !== null && currentStatus.id === statusId ? null : currentStatus);
            downloadStatusClearTimeoutRef.current = null;
        }, 4000);
    }, []);
    const getPendingDownloadKey = React.useCallback((downloadPayload) => {
        const sourceUrl = getPayloadSourceUrl(downloadPayload);
        if (!sourceUrl) {
            return null;
        }

        const payloadVideoId = downloadPayload?.videoId;
        return payloadVideoId ?
            `${downloadPayload.metaId || ''}::${payloadVideoId}::${sourceUrl}`
            :
            `${downloadPayload.metaId || ''}::${downloadPayload?.type || ''}::${sourceUrl}`;
    }, []);
    const onDownloadPlaceholder = React.useCallback(async (downloadPayload) => {
        const pendingDownloadKey = getPendingDownloadKey(downloadPayload);
        // eslint-disable-next-line no-console
        console.debug('customStremio.downloadPlaceholder', downloadPayload);

        if (pendingDownloadKey) {
            setPendingDownloadKeys((currentKeys) => ({
                ...currentKeys,
                [pendingDownloadKey]: true
            }));
        }

        try {
            const record = await createDownload(downloadPayload);
            if (record?.duplicate === true) {
                // eslint-disable-next-line no-console
                console.debug('customStremio.downloadDuplicate', record);
                showDownloadStatus('Already added.', 'duplicate');
            } else {
                // eslint-disable-next-line no-console
                console.debug('customStremio.downloadCreated', record);
                showDownloadStatus('Download queued.', 'created');
            }

            if (typeof onDownloadCreated === 'function') {
                onDownloadCreated(record);
            }
        } catch (error) {
            console.error('customStremio.downloadCreateError', {
                message: error?.message || 'Failed to create local backend download record',
                status: error?.status ?? null,
                backendError: error?.backendError ?? null
            });
            showDownloadStatus('Download backend unavailable.', 'error');
        } finally {
            if (pendingDownloadKey) {
                setPendingDownloadKeys((currentKeys) => {
                    const nextKeys = { ...currentKeys };
                    delete nextKeys[pendingDownloadKey];
                    return nextKeys;
                });
            }
        }
    }, [getPendingDownloadKey, onDownloadCreated, showDownloadStatus]);

    React.useEffect(() => {
        return () => {
            if (downloadStatusHideTimeoutRef.current !== null) {
                clearTimeout(downloadStatusHideTimeoutRef.current);
            }
            if (downloadStatusClearTimeoutRef.current !== null) {
                clearTimeout(downloadStatusClearTimeoutRef.current);
            }
        };
    }, []);
    const handleEpisodePicker = React.useCallback((season, episode) => {
        onEpisodeSearch(season, episode);
    }, [onEpisodeSearch]);

    return (
        <div className={classnames(className, styles['streams-list-container'])}>
            {
                downloadStatus !== null ?
                    <div className={styles['download-status-toast-container']} aria-live={'polite'} aria-atomic={'true'}>
                        <div
                            className={classnames(
                                styles['download-status-toast'],
                                styles[`download-status-toast-${downloadStatus.tone}`],
                                downloadStatus.visible ? styles['download-status-toast-visible'] : styles['download-status-toast-hidden']
                            )}
                            role={'status'}
                        >
                            {downloadStatus.message}
                        </div>
                    </div>
                    :
                    null
            }
            <div className={styles['select-choices-wrapper']}>
                {
                    video ?
                        <React.Fragment>
                            <Button className={classnames(styles['button-container'], styles['back-button-container'])} tabIndex={0} onClick={backButtonOnClick}>
                                <Icon className={styles['icon']} name={'chevron-back'} />
                            </Button>
                            <div className={styles['episode-title']}>
                                {typeof video.season === 'number' && typeof video.episode === 'number'
                                    ? `S${video.season}E${video.episode}${video.title ? ` ${video.title}` : ''}`
                                    : (video.title ?? '')}
                            </div>
                        </React.Fragment>
                        :
                        null
                }
                {
                    Object.keys(streamsByAddon).length > 1 ?
                        <MultiselectMenu
                            {...selectableOptions}
                            className={styles['select-input-container']}
                        />
                        :
                        null
                }
                {
                    Object.keys(streamsByAddon).length > 0 ?
                        <MultiselectMenu
                            {...preferredAddonOptions}
                            className={styles['select-input-container']}
                        />
                        :
                        null
                }
                {
                    allDebridConnected && filteredInfoHashes.length > 0 ?
                        <div className={styles['availability-controls']}>
                            <Button
                                className={styles['availability-check-button']}
                                title={t('CUSTOM_STREAM_CHECK_AVAILABILITY_TITLE', { defaultValue: 'Check the visible torrent hashes on AllDebrid' })}
                                disabled={availabilityChecking}
                                aria-busy={availabilityChecking}
                                onClick={onCheckAvailability}
                            >
                                <Icon className={classnames(styles['availability-check-icon'], availabilityChecking ? styles['availability-check-icon-active'] : null)} name={'checkmark'} />
                                <span>{availabilityChecking ?
                                    t('CUSTOM_STREAM_CHECKING_AVAILABILITY', { defaultValue: 'Checking…' })
                                    :
                                    t('CUSTOM_STREAM_CHECK_AVAILABILITY', { defaultValue: 'Check availability' })}
                                </span>
                            </Button>
                            {
                                availabilitySummary.cached > 0 || availabilitySummary.uncached > 0 ?
                                    <span className={styles['availability-summary']}>
                                        {`${availabilitySummary.cached} cached · ${availabilitySummary.uncached} not cached`}
                                    </span>
                                    : null
                            }
                            <span className={styles['availability-disclosure']}>
                                {t('CUSTOM_STREAM_CHECK_AVAILABILITY_DISCLOSURE', {
                                    defaultValue: 'Checks briefly create and remove temporary magnet entries in your AllDebrid account.'
                                })}
                            </span>
                            {
                                availabilityError ?
                                    <span className={styles['availability-error']} role={'alert'}>{availabilityError}</span>
                                    : null
                            }
                        </div>
                        : null
                }
            </div>
            {
                props.streams.length === 0 ?
                    <div className={styles['message-container']}>
                        {
                            type === 'series' ?
                                <SeasonEpisodePicker className={styles['search']} onSubmit={handleEpisodePicker} />
                                : null
                        }
                        <Image className={styles['image']} src={require('/assets/images/empty.png')} alt={' '} />
                        <div className={styles['label']}>{t('ERR_NO_ADDONS_FOR_STREAMS')}</div>
                    </div>
                    :
                    props.streams.every((streams) => streams.content.type === 'Err') ?
                        <div className={styles['message-container']}>
                            {
                                type === 'series' ?
                                    <SeasonEpisodePicker className={styles['search']} onSubmit={handleEpisodePicker} />
                                    : null
                            }
                            {
                                video?.upcoming ?
                                    <div className={styles['label']}>{t('UPCOMING')}...</div>
                                    : null
                            }
                            <Image className={styles['image']} src={require('/assets/images/empty.png')} alt={' '} />
                            <div className={styles['label']}>{t('NO_STREAM')}</div>
                            {
                                showInstallAddonsButton ?
                                    <Button className={styles['install-button-container']} title={t('ADDON_CATALOGUE_MORE')} href={'#/addons'}>
                                        <Icon className={styles['icon']} name={'addons'} />
                                        <div className={styles['label']}>{t('ADDON_CATALOGUE_MORE')}</div>
                                    </Button>
                                    :
                                    null
                            }
                        </div>
                        :
                        orderedFilteredStreams.length === 0 ?
                            <div className={styles['streams-container']}>
                                <Stream.Placeholder />
                                <Stream.Placeholder />
                            </div>
                            :
                            <React.Fragment>
                                <div className={styles['streams-container']} ref={streamsContainerRef}>
                                    {orderedFilteredStreams.map((stream, index) => {
                                        const availability = getStreamAvailability(stream);
                                        const sourceReadiness = getStreamReadiness(stream);
                                        const downloadPayload = {
                                            ...buildDownloadPayload({
                                                metaId,
                                                parentTitle,
                                                poster,
                                                background,
                                                mediaMetadata,
                                                type,
                                                video,
                                                addonName: stream.addonName,
                                                stream
                                            }),
                                            sourceReadiness
                                        };
                                        const downloadRecord = findMatchingDownloadRecord(downloadRecords, downloadPayload);
                                        const activeDownloadRecord = isActiveDownloadRecord(downloadRecord) ? downloadRecord : null;
                                        const downloadRecordId = activeDownloadRecord?.id;
                                        const pendingDownloadKey = getPendingDownloadKey(downloadPayload);
                                        const isDownloadPending = pendingDownloadKey ? pendingDownloadKeys[pendingDownloadKey] === true : false;

                                        return (
                                            <Stream
                                                key={index}
                                                videoId={video?.id}
                                                videoReleased={video?.released}
                                                addonName={stream.addonName}
                                                name={stream.name}
                                                description={stream.description}
                                                thumbnail={stream.thumbnail}
                                                progress={stream.progress}
                                                deepLinks={stream.deepLinks}
                                                downloadPayload={downloadPayload}
                                                downloadRecord={activeDownloadRecord}
                                                downloadAction={downloadRecordId ? downloadActionStates[downloadRecordId] : null}
                                                downloadActionError={downloadRecordId ? downloadActionErrors[downloadRecordId] : null}
                                                sourceReadiness={sourceReadiness}
                                                availabilityVerifiedAt={availability?.verifiedAt ?? null}
                                                isDownloadPending={isDownloadPending}
                                                onDownloadPlaceholder={onDownloadPlaceholder}
                                                onPlayDownload={onPlayDownload}
                                                onClick={stream.onClick}
                                            />
                                        );
                                    })}
                                    {
                                        showInstallAddonsButton ?
                                            <Button className={styles['install-button-container']} title={t('ADDON_CATALOGUE_MORE')} href={'#/addons'}>
                                                <Icon className={styles['icon']} name={'addons'} />
                                                <div className={styles['label']}>{t('ADDON_CATALOGUE_MORE')}</div>
                                            </Button>
                                            :
                                            null
                                    }
                                </div>
                                {
                                    countLoadingAddons > 0 ?
                                        <div className={styles['addons-loading-container']}>
                                            <div className={styles['addons-loading']}>
                                                {countLoadingAddons} {t('MOBILE_ADDONS_LOADING')}
                                            </div>
                                            <span className={styles['addons-loading-bar']}></span>
                                        </div>
                                        :
                                        null
                                }
                            </React.Fragment>
            }
        </div>
    );
};

StreamsList.propTypes = {
    className: PropTypes.string,
    metaId: PropTypes.string,
    parentTitle: PropTypes.string,
    poster: PropTypes.string,
    background: PropTypes.string,
    mediaMetadata: PropTypes.object,
    streams: PropTypes.arrayOf(PropTypes.object).isRequired,
    downloadRecords: PropTypes.arrayOf(PropTypes.object),
    downloadActionStates: PropTypes.objectOf(PropTypes.oneOf(['cancel', 'play', 'remove'])),
    downloadActionErrors: PropTypes.objectOf(PropTypes.string),
    video: PropTypes.object,
    type: PropTypes.string,
    onEpisodeSearch: PropTypes.func,
    onDownloadCreated: PropTypes.func,
    onPlayDownload: PropTypes.func
};

module.exports = StreamsList;

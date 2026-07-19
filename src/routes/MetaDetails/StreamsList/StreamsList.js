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
    getBackendSettings,
    checkAllDebridAvailability,
    getAllDebridAvailabilityHistory,
    checkRealDebridAvailability,
    probeRealDebridAvailability,
    getRealDebridAvailabilityHistory
} = require('stremio/customStremio/localBackendClient');
const {
    findMatchingDownloadRecord,
    findMatchingFailedDownloadRecord,
    getPayloadSourceUrl,
    isActiveDownloadRecord
} = require('stremio/customStremio/downloadRecordMatching');
const {
    DEBRID_PROVIDER,
    SOURCE_READINESS,
    createRealDebridSourceKey,
    getStreamInfoHash,
    getSourceReadinessSortRank,
    getRealDebridSourceDescriptor,
    getDebridProvider,
    classifyProviderSourceReadiness,
    shouldProbeRealDebridAvailability
} = require('stremio/customStremio/debridSourceReadiness');

const ALL_ADDONS_KEY = 'ALL';
const PREFERRED_ADDON_STORAGE_KEY = 'customStremio.preferredAddon';

const normalizeAddonName = (value) => String(value ?? '').trim().toLowerCase();
const getAvailabilityObservationTime = (item) => {
    const value = Date.parse(item?.checkedAt || item?.verifiedAt);
    return Number.isFinite(value) ? value : null;
};

const shouldReplaceAvailabilityItem = (currentItem, nextItem) => {
    if (!currentItem) {
        return true;
    }
    const currentTime = getAvailabilityObservationTime(currentItem);
    const nextTime = getAvailabilityObservationTime(nextItem);
    if (currentTime !== null && nextTime !== null) {
        return nextTime >= currentTime;
    }
    if (nextTime === null && ['completed_download', 'failed_download'].includes(currentItem.source)) {
        return false;
    }
    return true;
};

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
    const [availabilityProgress, setAvailabilityProgress] = React.useState(null);
    const [availabilityError, setAvailabilityError] = React.useState(null);
    const [realDebridAvailabilityByKey, setRealDebridAvailabilityByKey] = React.useState({});
    const [realDebridConnected, setRealDebridConnected] = React.useState(false);
    const [realDebridChecking, setRealDebridChecking] = React.useState(false);
    const [realDebridProgress, setRealDebridProgress] = React.useState(null);
    const [realDebridError, setRealDebridError] = React.useState(null);
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
                    streams: streams.content.content.map((stream) => {
                        const enrichedStream = {
                            ...stream,
                            addonName: streams.addon.manifest.name,
                            addonId: streams.addon.manifest.id,
                            addonDescription: streams.addon.manifest.description,
                            addonTransportUrl: streams.addon.transportUrl
                        };
                        return {
                            ...enrichedStream,
                            debridProvider: getDebridProvider(enrichedStream),
                            onClick: () => {
                                core.transport.analytics({
                                    event: 'StreamClicked',
                                    args: {
                                        stream
                                    }
                                });
                            }
                        };
                    })
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
        filteredStreams
            .filter((stream) => getDebridProvider(stream) === DEBRID_PROVIDER.ALLDEBRID)
            .map(getStreamInfoHash)
            .filter(Boolean)
    )), [filteredStreams]);
    const filteredInfoHashesKey = filteredInfoHashes.join(',');
    const filteredAllDebridRowCount = React.useMemo(() => filteredStreams.filter(
        (stream) => getDebridProvider(stream) === DEBRID_PROVIDER.ALLDEBRID
    ).length, [filteredStreams]);
    const filteredRealDebridRowCount = React.useMemo(() => filteredStreams.filter(
        (stream) => getDebridProvider(stream) === DEBRID_PROVIDER.REALDEBRID
    ).length, [filteredStreams]);
    const filteredRealDebridSources = React.useMemo(() => {
        const byKey = new Map();
        filteredStreams.forEach((stream) => {
            if (getDebridProvider(stream) !== DEBRID_PROVIDER.REALDEBRID) {
                return;
            }
            const descriptor = getRealDebridSourceDescriptor(stream);
            if (descriptor && !byKey.has(descriptor.key)) {
                byKey.set(descriptor.key, descriptor);
            }
        });
        return Array.from(byKey.values());
    }, [filteredStreams]);
    const filteredRealDebridSourcesKey = filteredRealDebridSources.map((source) => source.key).join(',');
    const applyAvailabilityItems = React.useCallback((items) => {
        if (!Array.isArray(items)) {
            return;
        }
        setAvailabilityByHash((currentItems) => {
            const nextItems = { ...currentItems };
            items.forEach((item) => {
                if (typeof item?.hash === 'string' && shouldReplaceAvailabilityItem(nextItems[item.hash.toLowerCase()], item)) {
                    nextItems[item.hash.toLowerCase()] = item;
                }
            });
            return nextItems;
        });
    }, []);
    const getStreamAvailability = React.useCallback((stream) => {
        if (getDebridProvider(stream) !== DEBRID_PROVIDER.ALLDEBRID) {
            return null;
        }
        const hash = getStreamInfoHash(stream);
        return hash ? availabilityByHash[hash] || null : null;
    }, [availabilityByHash]);
    const applyRealDebridAvailabilityItems = React.useCallback((items) => {
        if (!Array.isArray(items)) {
            return;
        }
        setRealDebridAvailabilityByKey((currentItems) => {
            const nextItems = { ...currentItems };
            items.forEach((item) => {
                if (typeof item?.key === 'string' && shouldReplaceAvailabilityItem(nextItems[item.key], item)) {
                    nextItems[item.key] = item;
                }
            });
            return nextItems;
        });
    }, []);
    const getStreamRealDebridAvailability = React.useCallback((stream) => {
        if (getDebridProvider(stream) !== DEBRID_PROVIDER.REALDEBRID) {
            return null;
        }
        const descriptor = getRealDebridSourceDescriptor(stream);
        return descriptor ? realDebridAvailabilityByKey[descriptor.key] || null : null;
    }, [realDebridAvailabilityByKey]);
    const getStreamReadiness = React.useCallback((stream) => {
        return classifyProviderSourceReadiness(stream, {
            allDebridAvailability: getStreamAvailability(stream),
            realDebridAvailability: getStreamRealDebridAvailability(stream)
        });
    }, [getStreamAvailability, getStreamRealDebridAvailability]);

    React.useEffect(() => {
        let canceled = false;
        getBackendSettings()
            .then((settings) => {
                if (canceled) {
                    return;
                }
                setAllDebridConnected(settings?.debrid?.allDebrid?.connected === true);
                setRealDebridConnected(settings?.debrid?.realDebrid?.connected === true);
            })
            .catch((error) => {
                if (canceled) {
                    return;
                }
                setAllDebridConnected(false);
                setRealDebridConnected(false);
                const message = error?.backendError || error?.message || 'Local download backend is offline.';
                setAvailabilityError(message);
                setRealDebridError(message);
            });
        return () => {
            canceled = true;
        };
    }, []);

    React.useEffect(() => {
        let canceled = false;
        getAllDebridAvailabilityHistory(filteredInfoHashes)
            .then((result) => {
                if (canceled) {
                    return;
                }
                applyAvailabilityItems(result?.items);
                setAvailabilityError(null);
            })
            .catch((error) => {
                if (!canceled) {
                    setAvailabilityError(error?.backendError || error?.message || 'Could not load AllDebrid availability history.');
                }
            });
        return () => {
            canceled = true;
        };
    }, [filteredInfoHashesKey, applyAvailabilityItems]);

    React.useEffect(() => {
        let canceled = false;
        getRealDebridAvailabilityHistory(filteredRealDebridSources)
            .then((result) => {
                if (canceled) {
                    return;
                }
                applyRealDebridAvailabilityItems(result?.items);
                setRealDebridError(null);
            })
            .catch((error) => {
                if (!canceled) {
                    setRealDebridError(error?.backendError || error?.message || 'Could not load Real-Debrid availability history.');
                }
            });
        return () => {
            canceled = true;
        };
    }, [filteredRealDebridSourcesKey, applyRealDebridAvailabilityItems]);

    React.useEffect(() => {
        const allDebridItems = [];
        const realDebridItems = [];
        [...downloadRecords].sort((left, right) => {
            return (Date.parse(left?.updatedAt) || 0) - (Date.parse(right?.updatedAt) || 0);
        }).forEach((record) => {
            if (!['completed', 'failed'].includes(record?.status) || !/^[a-f0-9]{40}$/i.test(record?.infoHash || '')) {
                return;
            }
            const status = record.status === 'completed' ? 'cached' :
                record.errorCode === 'SOURCE_NOT_READY' ? 'uncached' : 'unavailable';
            const verifiedAt = record.updatedAt || new Date().toISOString();
            const observationSource = record.status === 'completed' ? 'completed_download' : 'failed_download';
            const provider = getDebridProvider(record);
            if (provider === DEBRID_PROVIDER.ALLDEBRID) {
                allDebridItems.push({
                    hash: record.infoHash.toLowerCase(),
                    status,
                    verifiedAt,
                    source: observationSource,
                    previouslyVerified: false
                });
            } else if (provider === DEBRID_PROVIDER.REALDEBRID) {
                const source = {
                    hash: record.infoHash.toLowerCase(),
                    fileIdx: Number.isSafeInteger(record.fileIdx) ? record.fileIdx : null,
                    filename: record.behaviorHints?.filename || record.fileName || null,
                    videoSize: Number.isSafeInteger(record.behaviorHints?.videoSize) && record.behaviorHints.videoSize > 0 ?
                        record.behaviorHints.videoSize
                        : null
                };
                realDebridItems.push({
                    ...source,
                    key: createRealDebridSourceKey(source),
                    status,
                    verifiedAt,
                    source: observationSource,
                    previouslyVerified: false
                });
            }
        });
        applyAvailabilityItems(allDebridItems);
        applyRealDebridAvailabilityItems(realDebridItems);
    }, [downloadRecords, applyAvailabilityItems, applyRealDebridAvailabilityItems]);

    const onCheckAvailability = React.useCallback(async () => {
        if (availabilityChecking || filteredInfoHashes.length === 0) {
            return;
        }
        setAvailabilityChecking(true);
        setAvailabilityProgress({ completed: 0, total: filteredInfoHashes.length, currentHash: null });
        setAvailabilityError(null);
        try {
            const checked = await checkAllDebridAvailability(filteredInfoHashes, {
                batchSize: 1,
                onBatchStart: ({ batch, batchIndex, totalBatches }) => {
                    setAvailabilityProgress({ completed: batchIndex, total: totalBatches, currentHash: batch[0] || null });
                },
                onBatchComplete: ({ batchIndex, totalBatches, result }) => {
                    applyAvailabilityItems(result?.items);
                    setAvailabilityProgress({ completed: batchIndex + 1, total: totalBatches, currentHash: null });
                }
            });
            setAllDebridConnected(checked?.connected === true);
            applyAvailabilityItems(checked?.items);
            if (checked?.cleanupWarning) {
                setAvailabilityError(checked.cleanupWarning);
            }
        } catch (error) {
            setAvailabilityError(error?.backendError || error?.message || 'Could not check AllDebrid availability.');
        } finally {
            setAvailabilityChecking(false);
            setAvailabilityProgress(null);
        }
    }, [availabilityChecking, filteredInfoHashesKey, applyAvailabilityItems]);

    const onCheckRealDebridAvailability = React.useCallback(async () => {
        if (realDebridChecking || filteredRealDebridSources.length === 0) {
            return;
        }
        setRealDebridChecking(true);
        setRealDebridProgress({ completed: 0, total: filteredRealDebridSources.length, currentKey: null });
        setRealDebridError(null);
        try {
            const checkedItems = [];
            const cleanupWarnings = new Set();
            let connected = true;
            for (let index = 0; index < filteredRealDebridSources.length; index += 1) {
                const source = filteredRealDebridSources[index];
                setRealDebridProgress({
                    completed: index,
                    total: filteredRealDebridSources.length,
                    currentKey: source.key,
                    stage: 'cache'
                });
                const cacheResult = await checkRealDebridAvailability([source]);
                connected = connected && cacheResult?.connected !== false;
                if (cacheResult?.cleanupWarning) {
                    cleanupWarnings.add(cacheResult.cleanupWarning);
                }
                let item = Array.isArray(cacheResult?.items) ? cacheResult.items[0] : null;
                applyRealDebridAvailabilityItems(item ? [item] : []);

                if (shouldProbeRealDebridAvailability(item)) {
                    setRealDebridProgress({
                        completed: index,
                        total: filteredRealDebridSources.length,
                        currentKey: source.key,
                        stage: 'resolver'
                    });
                    const probeResult = await probeRealDebridAvailability(source);
                    connected = connected && probeResult?.connected !== false;
                    if (probeResult?.cleanupWarning) {
                        cleanupWarnings.add(probeResult.cleanupWarning);
                    }
                    item = probeResult?.item || item;
                    applyRealDebridAvailabilityItems(item ? [item] : []);
                }
                if (item) {
                    checkedItems.push(item);
                }
                setRealDebridProgress({
                    completed: index + 1,
                    total: filteredRealDebridSources.length,
                    currentKey: null,
                    stage: null
                });
            }

            setRealDebridConnected(connected);
            if (cleanupWarnings.size > 0) {
                setRealDebridError(Array.from(cleanupWarnings).join(' '));
            } else {
                const unresolvedCount = checkedItems.filter((item) =>
                    ['error', 'invalid', 'unknown'].includes(item?.status) && item?.error
                ).length;
                if (unresolvedCount > 0) {
                    setRealDebridError(`${unresolvedCount} source${unresolvedCount === 1 ? '' : 's'} could not be safely matched or checked.`);
                }
            }
        } catch (error) {
            setRealDebridError(error?.backendError || error?.message || 'Could not check Real-Debrid availability.');
        } finally {
            setRealDebridChecking(false);
            setRealDebridProgress(null);
        }
    }, [realDebridChecking, filteredRealDebridSourcesKey, applyRealDebridAvailabilityItems]);
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
                if (readinessDifference !== 0) {
                    return readinessDifference;
                }
                return left.index - right.index;
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
            } else if (status === 'unavailable') {
                summary.unavailable += 1;
            }
            return summary;
        }, { cached: 0, uncached: 0, unavailable: 0 });
    }, [filteredInfoHashesKey, availabilityByHash]);
    const realDebridAvailabilitySummary = React.useMemo(() => {
        return filteredRealDebridSources.reduce((summary, source) => {
            const status = realDebridAvailabilityByKey[source.key]?.status;
            if (Object.prototype.hasOwnProperty.call(summary, status)) {
                summary[status] += 1;
            }
            return summary;
        }, { cached: 0, ready: 0, uncached: 0, unavailable: 0 });
    }, [filteredRealDebridSourcesKey, realDebridAvailabilityByKey]);
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
            const errorCode = error?.responseBody?.errorCode;
            if (['SOURCE_NOT_READY', 'SOURCE_UNAVAILABLE'].includes(errorCode)) {
                const status = errorCode === 'SOURCE_NOT_READY' ? 'uncached' : 'unavailable';
                const verifiedAt = new Date().toISOString();
                if (downloadPayload.debridProvider === DEBRID_PROVIDER.ALLDEBRID && downloadPayload.infoHash) {
                    applyAvailabilityItems([{
                        hash: downloadPayload.infoHash,
                        status,
                        verifiedAt,
                        source: 'rejected_download',
                        previouslyVerified: false
                    }]);
                } else if (downloadPayload.debridProvider === DEBRID_PROVIDER.REALDEBRID && downloadPayload.infoHash) {
                    const source = {
                        hash: downloadPayload.infoHash,
                        fileIdx: Number.isSafeInteger(downloadPayload.fileIdx) ? downloadPayload.fileIdx : null,
                        filename: downloadPayload.behaviorHints?.filename || downloadPayload.fileName || null,
                        videoSize: Number.isSafeInteger(downloadPayload.behaviorHints?.videoSize) && downloadPayload.behaviorHints.videoSize > 0 ?
                            downloadPayload.behaviorHints.videoSize
                            : null
                    };
                    applyRealDebridAvailabilityItems([{
                        ...source,
                        key: createRealDebridSourceKey(source),
                        status,
                        verifiedAt,
                        source: 'rejected_download',
                        previouslyVerified: false
                    }]);
                }
                showDownloadStatus(error?.backendError || (status === 'unavailable' ? 'Source unavailable.' : 'Source not cached.'), 'error');
            } else {
                showDownloadStatus('Download backend unavailable.', 'error');
            }
        } finally {
            if (pendingDownloadKey) {
                setPendingDownloadKeys((currentKeys) => {
                    const nextKeys = { ...currentKeys };
                    delete nextKeys[pendingDownloadKey];
                    return nextKeys;
                });
            }
        }
    }, [getPendingDownloadKey, onDownloadCreated, showDownloadStatus, applyAvailabilityItems, applyRealDebridAvailabilityItems]);

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
                    filteredStreams.length > 0 ?
                        <div className={styles['availability-controls']}>
                            {
                                filteredStreams.length > 0 ?
                                    <div className={styles['availability-provider']}>
                                        <Button
                                            className={styles['availability-check-button']}
                                            title={t('CUSTOM_STREAM_CHECK_AVAILABILITY_TITLE', { defaultValue: 'Check the visible torrent hashes on AllDebrid' })}
                                            disabled={!allDebridConnected || availabilityChecking || filteredInfoHashes.length === 0}
                                            aria-busy={availabilityChecking}
                                            onClick={onCheckAvailability}
                                        >
                                            <Icon className={classnames(styles['availability-check-icon'], availabilityChecking ? styles['availability-check-icon-active'] : null)} name={'checkmark'} />
                                            <span>{availabilityChecking ?
                                                `Checking AllDebrid ${availabilityProgress?.completed || 0}/${availabilityProgress?.total || filteredInfoHashes.length}...`
                                                : !allDebridConnected ?
                                                    t('CUSTOM_STREAM_ALLDEBRID_NOT_CONNECTED', { defaultValue: 'AllDebrid not connected' })
                                                    : filteredAllDebridRowCount === 0 ?
                                                        t('CUSTOM_STREAM_NO_ALLDEBRID_SOURCES', { defaultValue: 'No AllDebrid sources' })
                                                        : filteredInfoHashes.length === 0 ?
                                                            t('CUSTOM_STREAM_ALLDEBRID_HASH_UNAVAILABLE', { defaultValue: 'AD hash unavailable' })
                                                            :
                                                            t('CUSTOM_STREAM_CHECK_AVAILABILITY', { defaultValue: 'Check AllDebrid' })}
                                            </span>
                                        </Button>
                                        {
                                            availabilitySummary.cached > 0 || availabilitySummary.uncached > 0 || availabilitySummary.unavailable > 0 ?
                                                <span className={styles['availability-summary']}>
                                                    {`${availabilitySummary.cached} cached · ${availabilitySummary.uncached} not cached · ${availabilitySummary.unavailable} unavailable`}
                                                </span>
                                                : null
                                        }
                                        <span className={styles['availability-disclosure']}>
                                            {filteredAllDebridRowCount === 0 ?
                                                t('CUSTOM_STREAM_NO_ALLDEBRID_SOURCES_HELP', {
                                                    defaultValue: 'The current filter does not contain an AllDebrid source.'
                                                })
                                                : filteredInfoHashes.length === 0 ?
                                                    t('CUSTOM_STREAM_ALLDEBRID_HASH_UNAVAILABLE_HELP', {
                                                        defaultValue: 'The visible AllDebrid source did not expose a torrent hash that can be checked safely.'
                                                    })
                                                    : t('CUSTOM_STREAM_CHECK_AVAILABILITY_DISCLOSURE', {
                                                        defaultValue: 'Checks briefly create and remove temporary magnet entries in your AllDebrid account.'
                                                    })}
                                        </span>
                                        {availabilityError ? <span className={styles['availability-error']} role={'alert'}>{availabilityError}</span> : null}
                                    </div>
                                    : null
                            }
                            {
                                filteredStreams.length > 0 ?
                                    <div className={styles['availability-provider']}>
                                        <Button
                                            className={classnames(styles['availability-check-button'], styles['availability-check-button-realdebrid'])}
                                            title={t('CUSTOM_STREAM_CHECK_REALDEBRID_TITLE', { defaultValue: 'Check each visible source file on Real-Debrid' })}
                                            disabled={!realDebridConnected || realDebridChecking || filteredRealDebridSources.length === 0}
                                            aria-busy={realDebridChecking}
                                            onClick={onCheckRealDebridAvailability}
                                        >
                                            <Icon className={classnames(styles['availability-check-icon'], realDebridChecking ? styles['availability-check-icon-active'] : null)} name={'checkmark'} />
                                            <span>{realDebridChecking ?
                                                `Checking Real-Debrid ${realDebridProgress?.completed || 0}/${realDebridProgress?.total || filteredRealDebridSources.length}...`
                                                : !realDebridConnected ?
                                                    t('CUSTOM_STREAM_REALDEBRID_NOT_CONNECTED', { defaultValue: 'Real-Debrid not connected' })
                                                    : filteredRealDebridRowCount === 0 ?
                                                        t('CUSTOM_STREAM_NO_REALDEBRID_SOURCES', { defaultValue: 'No Real-Debrid sources' })
                                                        : filteredRealDebridSources.length === 0 ?
                                                            t('CUSTOM_STREAM_REALDEBRID_HASH_UNAVAILABLE', { defaultValue: 'RD hash unavailable' })
                                                            :
                                                            t('CUSTOM_STREAM_CHECK_REALDEBRID', { defaultValue: 'Check Real-Debrid' })}
                                            </span>
                                        </Button>
                                        {
                                            realDebridAvailabilitySummary.cached > 0 || realDebridAvailabilitySummary.ready > 0 || realDebridAvailabilitySummary.uncached > 0 || realDebridAvailabilitySummary.unavailable > 0 ?
                                                <span className={styles['availability-summary']}>
                                                    {`${realDebridAvailabilitySummary.cached} cached · ${realDebridAvailabilitySummary.ready} link ready · ${realDebridAvailabilitySummary.uncached} not cached · ${realDebridAvailabilitySummary.unavailable} unavailable`}
                                                </span>
                                                : null
                                        }
                                        <span className={styles['availability-disclosure']}>
                                            {filteredRealDebridRowCount === 0 ?
                                                t('CUSTOM_STREAM_NO_REALDEBRID_SOURCES_HELP', {
                                                    defaultValue: 'The current filter does not contain a Real-Debrid source.'
                                                })
                                                : filteredRealDebridSources.length === 0 ?
                                                    t('CUSTOM_STREAM_REALDEBRID_HASH_UNAVAILABLE_HELP', {
                                                        defaultValue: 'This addon identified the row as Real-Debrid but did not expose a torrent hash that can be checked safely.'
                                                    })
                                                    :
                                                    t('CUSTOM_STREAM_CHECK_REALDEBRID_DISCLOSURE', {
                                                        defaultValue: 'Explicitly adds, selects, and removes temporary Real-Debrid torrents.'
                                                    })}
                                        </span>
                                        {realDebridError ? <span className={styles['availability-error']} role={'alert'}>{realDebridError}</span> : null}
                                    </div>
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
                                        const realDebridAvailability = getStreamRealDebridAvailability(stream);
                                        const streamProvider = getDebridProvider(stream);
                                        const streamInfoHash = streamProvider === DEBRID_PROVIDER.ALLDEBRID ? getStreamInfoHash(stream) : null;
                                        const realDebridDescriptor = streamProvider === DEBRID_PROVIDER.REALDEBRID ? getRealDebridSourceDescriptor(stream) : null;
                                        const isAvailabilityChecking = streamProvider === DEBRID_PROVIDER.ALLDEBRID ?
                                            Boolean(streamInfoHash && availabilityProgress?.currentHash === streamInfoHash)
                                            : streamProvider === DEBRID_PROVIDER.REALDEBRID ?
                                                Boolean(realDebridDescriptor && realDebridProgress?.currentKey === realDebridDescriptor.key)
                                                : false;
                                        const availabilityCheckStage = isAvailabilityChecking && streamProvider === DEBRID_PROVIDER.REALDEBRID ?
                                            realDebridProgress?.stage || 'cache'
                                            : 'cache';
                                        const availabilityCheckError = availability?.error || realDebridAvailability?.error || null;
                                        const baseDownloadPayload = buildDownloadPayload({
                                            metaId,
                                            parentTitle,
                                            poster,
                                            background,
                                            mediaMetadata,
                                            type,
                                            video,
                                            addonName: stream.addonName,
                                            stream
                                        });
                                        const downloadRecord = findMatchingDownloadRecord(downloadRecords, baseDownloadPayload);
                                        const failedDownloadRecord = downloadRecord ? null :
                                            findMatchingFailedDownloadRecord(downloadRecords, baseDownloadPayload);
                                        const sourceReadiness = failedDownloadRecord ?
                                            failedDownloadRecord.errorCode === 'SOURCE_NOT_READY' ?
                                                SOURCE_READINESS.REQUIRES_CACHING
                                                : SOURCE_READINESS.UNAVAILABLE
                                            : getStreamReadiness(stream);
                                        const downloadPayload = { ...baseDownloadPayload, sourceReadiness };
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
                                                debridProvider={streamProvider}
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
                                                realDebridAvailability={realDebridAvailability}
                                                isAvailabilityChecking={isAvailabilityChecking}
                                                availabilityCheckStage={availabilityCheckStage}
                                                availabilityCheckError={availabilityCheckError}
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

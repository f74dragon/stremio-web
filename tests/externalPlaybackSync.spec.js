const {
    SYNC_LEDGER_PREFIX, getEligibleProgress, getMetadataUrl, createMetadataResolver, createExternalPlaybackSync
} = require('../src/customStremio/externalPlaybackSync');

const NOW = Date.parse('2026-10-24T12:00:00Z');
const download = { id: 'download-1', status: 'completed', metaId: 'tt123', type: 'movie',
    videoId: 'tt123', parentTitle: 'Example' };
const observation = { downloadId: download.id, metaId: 'tt123', mediaType: 'movie', videoId: 'tt123',
    contentKey: 'movie:tt123:tt123', positionMs: 400, durationMs: 1000, state: 'playing',
    lastObservedAt: new Date(NOW).toISOString(), player: { kind: 'mpc-hc', telemetry: 'web-interface' } };
const enabled = { player: { progressTracking: { enabled: true, localhostOnlyConfirmed: true, watchedSyncEnabled: true } } };
const context = { profile: { auth: { user: { _id: 'user-a' } }, addons: [] } };
const createHarness = (options = {}) => {
    const core = { transport: { getState: jest.fn(async (model) => model === 'ctx' ? context : { selected: null }),
        dispatch: jest.fn().mockResolvedValue(undefined) } };
    const backend = { getBackendSettings: jest.fn().mockResolvedValue(enabled),
        listDownloads: jest.fn().mockResolvedValue({ items: [download] }),
        listPlaybackProgress: jest.fn().mockResolvedValue({ records: [observation] }) };
    const entries = new Map();
    const storage = { getItem: jest.fn((key) => entries.get(key)), setItem: jest.fn((key, value) => entries.set(key, value)) };
    const onStatus = jest.fn();
    const service = createExternalPlaybackSync({ core, backend, storage, accountId: 'user-a', now: () => NOW,
        onStatus, ...options });
    return { core, backend, storage, service, onStatus };
};

test('accepts replacement positions and rejects mismatched/unverified/invalid observations', () => {
    expect(getEligibleProgress([download], [observation], {}, NOW)).toHaveLength(1);
    expect(getEligibleProgress([download], [{ ...observation, positionMs: 0 }], {}, NOW)).toHaveLength(1);
    for (const invalid of [
        { downloadId: 'other' }, { metaId: 'other' }, { mediaType: 'series' }, { videoId: 'other' },
        { contentKey: 'forged' }, { durationMs: 0 }, { durationMs: NaN }, { positionMs: -1 }, { positionMs: 1001 },
        { positionMs: 1.1 }, { player: null }, { lastObservedAt: 'invalid' },
        { lastObservedAt: new Date(NOW + 120000).toISOString() }
    ]) {
        expect(getEligibleProgress([download], [{ ...observation, ...invalid }], {}, NOW)).toEqual([]);
    }
    expect(getEligibleProgress([{ ...download, status: 'paused' }], [observation], {}, NOW)).toEqual([]);
});

test('deduplicates and throttles progress but flushes pause, rewind and completion', () => {
    const ledger = { [observation.contentKey]: { observedAt: NOW - 1000, position: 200, duration: 1000, syncedAt: NOW - 1000 } };
    expect(getEligibleProgress([download], [observation], ledger, NOW)).toEqual([]);
    expect(getEligibleProgress([download], [{ ...observation, state: 'paused', positionMs: 100 }], ledger, NOW)).toHaveLength(1);
    expect(getEligibleProgress([download], [{ ...observation, positionMs: 900 }], ledger, NOW)).toHaveLength(1);
    ledger[observation.contentKey].completed = true;
    expect(getEligibleProgress([download], [{ ...observation, positionMs: 950 }], ledger, NOW)).toEqual([]);
});

test('retains the exact legacy movie content key when no video id was saved', () => {
    const candidates = getEligibleProgress([{ ...download, videoId: null }],
        [{ ...observation, videoId: null, contentKey: 'movie:tt123' }], {}, NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ contentKey: 'movie:tt123', videoId: 'tt123' });
});

test('dispatches the supported context action, saves an account-scoped ledger and deduplicates', async () => {
    const h = createHarness();
    await h.service.run();
    expect(h.core.transport.dispatch).toHaveBeenCalledWith({ action: 'Ctx', args: {
        action: 'ExternalPlaybackProgressChanged', args: {
            meta_item: expect.objectContaining({ id: 'tt123', type: 'movie', name: 'Example' }),
            video_id: 'tt123', time: 400, duration: 1000, observed_at: observation.lastObservedAt
        }
    } });
    expect(h.storage.setItem).toHaveBeenCalledWith(`${SYNC_LEDGER_PREFIX}user-a`, expect.any(String));
    await h.service.run();
    expect(h.core.transport.dispatch).toHaveBeenCalledTimes(1);
});

test('retries rejected dispatches without recording success', async () => {
    const h = createHarness();
    h.core.transport.dispatch.mockRejectedValueOnce(new Error('Bridge unavailable'));
    await h.service.run();
    expect(h.storage.setItem).not.toHaveBeenCalled();
    expect(h.onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'retrying' }));
    await h.service.run();
    expect(h.storage.setItem).toHaveBeenCalledTimes(1);
});

test('requires opt-in, a reachable backend, the same account and no active native Player', async () => {
    for (const progressTracking of [
        { ...enabled.player.progressTracking, enabled: false },
        { ...enabled.player.progressTracking, watchedSyncEnabled: false },
        { ...enabled.player.progressTracking, localhostOnlyConfirmed: false }
    ]) {
        const h = createHarness();
        h.backend.getBackendSettings.mockResolvedValue({ player: { progressTracking } });
        await h.service.run();
        expect(h.core.transport.dispatch).not.toHaveBeenCalled();
    }
    for (const ctx of [{ profile: { auth: null } }, { profile: { auth: { user: { _id: 'other' } } } }]) {
        const h = createHarness();
        h.core.transport.getState.mockImplementation(async (model) => model === 'ctx' ? ctx : { selected: null });
        await h.service.run();
        expect(h.core.transport.dispatch).not.toHaveBeenCalled();
    }
    const h = createHarness();
    h.core.transport.getState.mockImplementation(async (model) => model === 'ctx' ? context : { selected: {} });
    await h.service.run();
    expect(h.core.transport.dispatch).not.toHaveBeenCalled();
    h.backend.getBackendSettings.mockRejectedValue(new Error('Offline'));
    await h.service.run();
    expect(h.storage.setItem).not.toHaveBeenCalled();
});

test('rechecks account and cancellation after metadata resolution', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const h = createHarness({ resolveMetadata: () => pending });
    const run = h.service.run();
    await new Promise((resolve) => setImmediate(resolve));
    h.service.stop();
    release({ id: 'tt123', type: 'movie', name: 'Example' });
    await run;
    expect(h.core.transport.dispatch).not.toHaveBeenCalled();
});

test('does not dispatch if account, consent, or native playback changes during metadata loading', async () => {
    for (const change of ['account', 'consent', 'player']) {
        let h;
        h = createHarness({ resolveMetadata: async () => {
            if (change === 'consent') {
                h.backend.getBackendSettings.mockResolvedValue({});
            } else {
                h.core.transport.getState.mockImplementation(async (model) => model === 'ctx' ?
                    (change === 'account' ? { profile: { auth: null } } : context) : { selected: {} });
            }
            return { id: 'tt123', type: 'movie', name: 'Example' };
        } });
        await h.service.run();
        expect(h.core.transport.dispatch).not.toHaveBeenCalled();
        expect(h.storage.setItem).not.toHaveBeenCalled();
    }
});

test('retries failed account delivery through normal Core sync after backoff', async () => {
    let time = NOW;
    const h = createHarness({ now: () => time });
    const listeners = {};
    h.core.on = jest.fn((name, listener) => { listeners[name] = listener; });
    h.core.off = jest.fn();
    await h.service.start();
    try {
        listeners.error({ event: 'LibraryItemsPushedToAPI', args: { ids: ['tt123'] } });
        await h.service.run();
        expect(h.core.transport.dispatch).toHaveBeenCalledTimes(1);
        time += 16000;
        await h.service.run();
        expect(h.core.transport.dispatch).toHaveBeenLastCalledWith({ action: 'Ctx', args: { action: 'SyncLibraryWithAPI' } });
        listeners.event('LibraryItemsPushedToAPI', { ids: ['tt123'] });
        expect(h.onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'synced' }));
    } finally {
        h.service.stop();
    }
    expect(h.core.off).toHaveBeenCalledTimes(2);
});

test('metadata requests respect installed addon resources and retain the full episode list', async () => {
    const addon = { transportUrl: 'https://addon.example/config/manifest.json', manifest: {
        types: ['series'], resources: [{ name: 'meta', types: ['series'], idPrefixes: ['tt'] }]
    } };
    expect(getMetadataUrl(addon, 'series', 'tt123')).toBe('https://addon.example/config/meta/series/tt123.json');
    expect(getMetadataUrl(addon, 'movie', 'tt123')).toBeNull();
    expect(getMetadataUrl(addon, 'series', 'other')).toBeNull();
    const series = { ...download, type: 'series', videoId: 'tt123:1:1' };
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, headers: { get: () => null }, text: async () => JSON.stringify({
        meta: { id: 'tt123', type: 'series', name: 'Show', videos: [
            { id: 'tt123:1:1', season: 1, episode: 1, released: '2020-01-01T00:00:00Z' },
            { id: 'tt123:1:2', season: 1, episode: 2, released: '2020-01-02T00:00:00Z' }
        ] }
    }) });
    const resolver = createMetadataResolver({ fetchFn, now: () => NOW });
    const ctx = { profile: { ...context.profile, addons: [addon] } };
    expect((await resolver(series, ctx)).videos).toHaveLength(2);
    expect((await resolver(series, ctx)).videos).toHaveLength(2);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await createMetadataResolver({ fetchFn })(series, context)).toBeNull();
});

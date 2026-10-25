const assert = require('node:assert/strict');
const fs = require('node:fs');

// Exercise the distributed WASM and JS glue with synthetic storage and no network.
// This script never reads browser storage, account credentials or media records.
global.self = globalThis;
global.WorkerGlobalScope = class {
    static [Symbol.hasInstance](value) { return value === globalThis; }
};
self.app_version = '5.0.0-beta.37';
self.shell_version = undefined;
self.location = { href: 'http://localhost/worker.js' };
self.get_location_hash = async () => '#/';
const storage = new Map();
self.local_storage_get_item = async (key) => storage.get(key) ?? null;
self.local_storage_set_item = async (key, value) => { storage.set(key, value); };
self.local_storage_remove_item = async (key) => { storage.delete(key); };
global.fetch = async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } });
const core = require('@stremio/stremio-core-web');
const manifest = require('@stremio/stremio-core-web/package.json');
const waitFor = async (predicate) => {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (predicate()) { return; }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for Core state');
};
const run = async () => {
    assert.equal(manifest.version, '0.58.0-custom.1');
    core.initSync({ module: fs.readFileSync(require.resolve('@stremio/stremio-core-web/stremio_core_web_bg.wasm')) });
    const events = [];
    await core.initialize_runtime((event) => events.push(event));
    core.dispatch({ action: 'Ctx', args: { action: 'ExternalPlaybackProgressChanged', args: {
        meta_item: { id: 'synthetic-movie', type: 'movie', name: 'Synthetic Movie' },
        video_id: 'synthetic-movie', time: 400, duration: 1000, observed_at: new Date().toISOString()
    } } }, undefined, '#/downloads');
    await waitFor(() => core.get_state('continue_watching_preview').items.some((item) => item._id === 'synthetic-movie'));
    assert.equal(core.get_state('continue_watching_preview').items.find((item) => item._id === 'synthetic-movie').progress, 40);
    await waitFor(() => Array.from(storage.values()).some((value) => value.includes('synthetic-movie')));
    assert.ok(events.some((event) => event.name === 'NewState'));
    const savedItem = (id) => Array.from(storage.values()).map((value) => {
        try { return JSON.parse(value)?.items?.[id]; } catch { return null; }
    }).find(Boolean);
    const series = { id: 'synthetic-show', type: 'series', name: 'Synthetic Show', videos: [
        { id: 'synthetic-show:1:1', season: 1, episode: 1, released: '2020-01-01T00:00:00Z' },
        { id: 'synthetic-show:2:1', season: 2, episode: 1, released: '2020-01-02T00:00:00Z' }
    ] };
    const send = (videoId, observedAt) => core.dispatch({ action: 'Ctx', args: {
        action: 'ExternalPlaybackProgressChanged', args: { meta_item: series,
            video_id: videoId, time: 900, duration: 1000, observed_at: observedAt }
    } }, undefined, '#/downloads');
    const observedAt = Date.now();
    send('synthetic-show:1:1', new Date(observedAt).toISOString());
    await waitFor(() => savedItem('synthetic-show')?.state.video_id === 'synthetic-show:2:1');
    assert.equal(savedItem('synthetic-show').state.timeOffset, 1);
    send('synthetic-show:2:1', new Date(observedAt + 1).toISOString());
    await waitFor(() => savedItem('synthetic-show')?.state.timeOffset === 0);
    assert.equal(core.get_state('continue_watching_preview').items.some((item) => item._id === 'synthetic-show'), false);
    console.log('PASS: installed custom WASM persists progress, updates native Continue Watching, advances seasons, and clears the final episode.');
};
run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });

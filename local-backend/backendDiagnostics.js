const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const check = (id, label, state, detail) => ({ id, label, state, detail });
const checkDirectory = async (directory, id, label) => {
    const probe = path.join(directory, `.stremio-health-${crypto.randomUUID()}.tmp`);
    let created = false;
    try {
        await fs.promises.writeFile(probe, 'health', { flag: 'wx' });
        created = true;
        await fs.promises.unlink(probe);
        created = false;
        return check(id, label, 'ok', 'Files can be saved here.');
    } catch (error) {
        return check(id, label, 'warning', error.code === 'ENOENT' ?
            'Folder is missing. Downloads create their folder when they start; reconnect an unavailable drive.' :
            'Cannot write here. Check the drive, free space, and folder permissions.');
    } finally {
        if (created) await fs.promises.unlink(probe).catch(() => { /* Leave an inaccessible probe for manual cleanup. */ });
    }
};

const createBackendDiagnostics = ({ getSettings, getRecords, getScheduler, isReady, dataDirectory,
    downloadsDirectory, version, validatePlayer, allDebridClient, realDebridClient, getRealDebridToken,
    mpcClient, fetchImpl = fetch }) => {
    let connections = [];
    let checkedConnectionsAt = null;
    let inFlight;
    let lastRejection = null;
    let connectionIdentity;
    const identity = (settings) => JSON.stringify([settings.debrid, settings.player.progressTracking]);
    const rememberRejection = (status, code) => {
        lastRejection = { time: new Date().toISOString(), status,
            code: typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'DOWNLOAD_REJECTED' };
    };
    const snapshot = async () => {
        const settings = getSettings();
        if (connectionIdentity !== identity(settings)) { connections = []; checkedConnectionsAt = null; }
        const records = getRecords();
        const counts = {};
        for (const record of records) counts[record.status] = (counts[record.status] || 0) + 1;
        const scheduler = getScheduler();
        const checks = [check('backend', 'Download service', isReady() ? 'ok' : 'warning',
            isReady() ? `Version ${version} · running for ${Math.floor(process.uptime() / 60)} minutes` : 'Starting or saving work.'),
        check('queue', 'Queue and transfers', 'ok', `${scheduler.activeCount} transferring · ${scheduler.queuedCount} queued · ${counts.paused || 0} paused`),
        check('stores', 'Saved downloads and progress', isReady() ? 'ok' : 'unverified',
            isReady() ? 'Settings, records, history, and playback progress loaded.' : 'Waiting for recovery.')];
        checks.push(...await Promise.all([
            checkDirectory(dataDirectory, 'data', 'App data storage'),
            checkDirectory(downloadsDirectory, 'media', 'Download storage')
        ]));
        if (settings.player.executablePath) {
            try { await validatePlayer(settings.player.executablePath); checks.push(check('player', 'Media player', 'ok', 'Selected executable is available.')); }
            catch { checks.push(check('player', 'Media player', 'warning', 'Selected executable is unavailable. Choose it again below.')); }
        } else checks.push(check('player', 'Media player', 'off', 'Select MPC-HC below for local playback.'));
        for (const [id, label, configured] of [
            ['alldebrid', 'AllDebrid', Boolean(settings.debrid.allDebrid?.apiKey)],
            ['realdebrid', 'Real-Debrid', Boolean(settings.debrid.realDebrid?.refreshToken)],
            ['mpc', 'MPC-HC progress', settings.player.progressTracking.enabled],
            ['streaming', 'Stremio streaming service', true]
        ]) {
            const previous = connections.find((item) => item.id === id);
            checks.push(!configured ? check(id, label, 'off', 'Not enabled. Optional for other features.') :
                previous || check(id, label, 'unverified', 'Not tested in this session. Run connection checks.'));
        }
        return { checkedAt: new Date().toISOString(), checkedConnectionsAt, checks, lastRejection,
            syncEnabled: settings.player.progressTracking.watchedSyncEnabled === true,
            downloads: { ...counts, maxConcurrent: scheduler.maxConcurrentDownloads,
                speedBytesPerSecond: records.reduce((sum, record) => sum + (record.status === 'downloading' ? Number(record.speedBytesPerSecond) || 0 : 0), 0) } };
    };
    const checkConnections = () => {
        if (inFlight) return inFlight;
        const settings = getSettings();
        connectionIdentity = identity(settings);
        const run = async (id, label, configured, operation, success, failure) => {
            if (!configured) return check(id, label, 'off', 'Not enabled. Optional for other features.');
            try { return await operation() ? check(id, label, 'ok', success) : check(id, label, 'warning', failure); }
            catch { return check(id, label, 'warning', failure); }
        };
        inFlight = (async () => {
            connections = await Promise.all([
                run('alldebrid', 'AllDebrid', settings.debrid.allDebrid?.apiKey,
                    async () => Boolean(await allDebridClient.getUser(settings.debrid.allDebrid.apiKey)),
                    'Account API responded. Individual sources can still be slow or unavailable.', 'Account check failed. Recheck the provider connection below.'),
                run('realdebrid', 'Real-Debrid', settings.debrid.realDebrid?.refreshToken,
                    async () => Boolean(await realDebridClient.getUser(await getRealDebridToken())),
                    'Account API responded. Individual sources can still be slow or unavailable.', 'Account check failed. Recheck the provider connection below.'),
                run('mpc', 'MPC-HC progress', settings.player.progressTracking.enabled,
                    async () => Boolean(await mpcClient.getStatus(settings.player.progressTracking.port)),
                    'Local Web Interface responded.', 'No response. Open MPC-HC and check its localhost Web Interface settings.'),
                run('streaming', 'Stremio streaming service', true,
                    async () => (await fetchImpl('http://127.0.0.1:11470/settings', { signal: AbortSignal.timeout(3000), redirect: 'error' })).ok,
                    'Local service responded on port 11470.', 'Not running. Optional for direct downloads; some in-app streams need it.')
            ]);
            checkedConnectionsAt = new Date().toISOString();
            return snapshot();
        })().finally(() => { inFlight = null; });
        return inFlight;
    };
    return { snapshot, checkConnections, rememberRejection };
};

module.exports = { createBackendDiagnostics, checkDirectory };

// Runs in Electron's Node utility process; Node fork support keeps lifecycle tests real.
const port = process.parentPort;
const send = (message) => {
    try {
        if (port) port.postMessage(message);
        else if (process.connected) process.send(message);
    } catch { /* The parent may already have exited. */ }
};
let service;
let started = false;
let closing = false;
let instanceId;
let watchdog;
let lastHeartbeat = Date.now();
let missedHeartbeats = 0;
const initialTimeout = setTimeout(() => process.exit(1), 10000);

const stop = async (reason) => {
    if (closing) return;
    closing = true;
    clearTimeout(initialTimeout);
    clearInterval(watchdog);
    try {
        if (service) await service.shutdown(reason);
        send({ type: 'stopped', instanceId, clean: true });
        process.exit(0);
    } catch {
        send({ type: 'stopped', instanceId, clean: false });
        process.exit(1);
    }
};

const handle = async (message) => {
    if (message?.type === 'start' && !started && !closing) {
        if (typeof message.token !== 'string' || !/^[a-f0-9]{64}$/.test(message.token) ||
            typeof message.instanceId !== 'string' || typeof message.dataDirectory !== 'string' || !Number.isInteger(message.parentPid)) {
            process.exit(1);
            return;
        }
        started = true;
        instanceId = message.instanceId;
        clearTimeout(initialTimeout);
        process.env.CUSTOM_STREMIO_DATA_DIR = message.dataDirectory;
        process.env.CUSTOM_STREMIO_DESKTOP_MANAGED = '1';
        process.env.CUSTOM_STREMIO_BACKEND_TOKEN = message.token;
        process.env.CUSTOM_STREMIO_BACKEND_INSTANCE_ID = instanceId;
        process.env.PORT = '0';
        service = require('../local-backend/server');
        watchdog = setInterval(() => {
            let parentAlive = true;
            try { process.kill(message.parentPid, 0); } catch (error) { parentAlive = error.code !== 'ESRCH'; }
            missedHeartbeats = Date.now() - lastHeartbeat > 30000 ? missedHeartbeats + 1 : 0;
            if (!parentAlive || missedHeartbeats >= 5) stop('parent-disconnected');
        }, 1000);
        try {
            const connection = await service.startServer();
            if (!closing) send({ type: 'ready', ...connection });
        } catch (error) {
            const known = ['DATA_ROOT_IN_USE', 'LEGACY_BACKEND_RUNNING', 'EADDRINUSE'];
            send({ type: 'startup-error', instanceId, code: known.includes(error.code) ? error.code : 'BACKEND_START_FAILED' });
            await stop('startup-failed');
        }
    } else if (message?.instanceId === instanceId) {
        if (message.type === 'heartbeat') lastHeartbeat = Date.now();
        if (message.type === 'shutdown') await stop('desktop-quit');
    }
};

if (port) port.on('message', ({ data }) => handle(data).catch(() => stop('control-error')));
else if (process.send) {
    process.on('message', (message) => handle(message).catch(() => stop('control-error')));
    process.on('disconnect', () => stop('parent-disconnected'));
} else process.exit(1);

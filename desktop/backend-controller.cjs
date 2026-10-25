const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const path = require('node:path');
const { checkDesktopBackendCompatibility } = require('./backend-compatibility.cjs');
const { TOKEN_HEADER } = require('../local-backend/managedAccess');
const { isLocalBackendUrl: validBackendUrl } = require('../src/customStremio/localBackendProtocol');

const STARTUP_MESSAGES = {
    DATA_ROOT_IN_USE: 'This data folder is already in use. Close its other Custom Stremio app or terminal backend, then retry.',
    LEGACY_BACKEND_RUNNING: 'A terminal backend is already running on port 5577. Stop it in its terminal, then retry. Your downloads and settings will be kept.',
    EADDRINUSE: 'The local service could not reserve a connection. Please retry.',
    BACKEND_START_FAILED: 'The local service could not load your saved data. Your files have been kept. Open diagnostics for the error code.'
};

class BackendController extends EventEmitter {
    constructor({ fork, dataDirectory, startupTimeout = 20000, shutdownTimeout = 30000 }) {
        super();
        this.fork = fork;
        this.dataDirectory = dataDirectory;
        this.startupTimeout = startupTimeout;
        this.shutdownTimeout = shutdownTimeout;
        this.child = null;
        this.connection = null;
        this.phase = 'stopped';
    }

    send(message) {
        if (!this.child) return;
        try {
            if (this.child.postMessage) this.child.postMessage(message);
            else if (this.child.connected) this.child.send(message, () => { /* Exit is handled separately. */ });
        } catch { /* A child can exit between the ownership check and IPC send. */ }
    }

    start() {
        if (this.child) return Promise.reject(new Error('The owned service must stop before restarting.'));
        this.phase = 'starting';
        this.connection = null;
        this.instanceId = crypto.randomUUID();
        this.token = crypto.randomBytes(32).toString('hex');
        const env = { ...process.env };
        delete env.NODE_OPTIONS;
        delete env.ELECTRON_RUN_AS_NODE;
        const child = this.fork(path.join(__dirname, 'backend-entry.cjs'), { env, stdio: 'ignore' });
        this.child = child;
        this.exited = new Promise((resolve) => {
            let exited = false;
            const finish = (code) => {
                if (exited) return;
                exited = true;
                const unexpected = this.phase !== 'stopping';
                clearInterval(this.heartbeat);
                this.child = null;
                this.connection = null;
                this.phase = unexpected ? 'failed' : 'stopped';
                resolve(code);
                if (unexpected) this.emit('failure', { code: 'BACKEND_EXITED', message: 'The local service stopped unexpectedly. Retry to recover saved downloads.' });
            };
            child.once('exit', finish);
            child.once('error', () => { if (!child.pid) finish(null); });
        });
        return new Promise((resolve, reject) => {
            let settled = false;
            const fail = (code) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                const error = new Error(STARTUP_MESSAGES[code] || 'The local service did not become ready. Please retry.');
                error.code = code;
                reject(error);
            };
            const timeout = setTimeout(() => fail('BACKEND_START_TIMEOUT'), this.startupTimeout);
            child.once('error', () => fail('BACKEND_START_FAILED'));
            child.once('exit', () => fail('BACKEND_EXITED'));
            child.on('message', async (message) => {
                if (message?.instanceId !== this.instanceId || settled) return;
                if (message.type === 'startup-error') { fail(message.code); return; }
                if (message.type !== 'ready') return;
                if (!validBackendUrl(message.baseUrl) || !checkDesktopBackendCompatibility({ ok: true, ...message }).compatible) {
                    fail('BACKEND_INCOMPATIBLE');
                    return;
                }
                try {
                    const response = await fetch(`${message.baseUrl}/health`, {
                        headers: { [TOKEN_HEADER]: this.token }, signal: AbortSignal.timeout(3000), redirect: 'error'
                    });
                    const health = await response.json();
                    if (!response.ok || !checkDesktopBackendCompatibility(health).compatible || health.instanceId !== this.instanceId) {
                        fail('BACKEND_INCOMPATIBLE');
                        return;
                    }
                    if (this.child !== child || this.phase !== 'starting' || settled) { fail('BACKEND_START_CANCELLED'); return; }
                    settled = true;
                    clearTimeout(timeout);
                    this.connection = { baseUrl: message.baseUrl, token: this.token, instanceId: this.instanceId };
                    this.phase = 'ready';
                    resolve(this.connection);
                } catch { fail('BACKEND_HEALTH_FAILED'); }
            });
            child.once('spawn', () => {
                if (this.phase !== 'starting') { child.kill(); return; }
                this.send({ type: 'start', token: this.token, instanceId: this.instanceId, dataDirectory: this.dataDirectory, parentPid: process.pid });
                this.heartbeat = setInterval(() => this.send({ type: 'heartbeat', instanceId: this.instanceId }), 2000);
            });
        });
    }

    async stop() {
        if (!this.child) return { forced: false };
        if (this.stopPromise) return this.stopPromise;
        this.stopPromise = this.stopOwnedChild();
        try { return await this.stopPromise; } finally { this.stopPromise = null; }
    }

    async stopOwnedChild() {
        const child = this.child;
        this.phase = 'stopping';
        this.send({ type: 'shutdown', instanceId: this.instanceId });
        let timeout;
        const timedOut = await Promise.race([
            this.exited.then(() => false),
            new Promise((resolve) => { timeout = setTimeout(() => resolve(true), this.shutdownTimeout); })
        ]);
        clearTimeout(timeout);
        if (timedOut && this.child === child) {
            child.kill();
            let killTimeout;
            const stopped = await Promise.race([
                this.exited.then(() => true),
                new Promise((resolve) => { killTimeout = setTimeout(() => resolve(false), 5000); })
            ]);
            clearTimeout(killTimeout);
            if (!stopped) throw new Error('The owned local service has not exited. Retry Quit.');
        }
        return { forced: timedOut };
    }
}

module.exports = { BackendController, validBackendUrl, STARTUP_MESSAGES };

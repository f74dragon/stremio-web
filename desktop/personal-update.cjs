const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const SCHEMAS = { records: 1, settings: 6, history: 1, progress: 1 };
const fail = (code) => { const error = new Error(code); error.code = code; throw error; };
const versionParts = (value) => {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-alpha\.(0|[1-9]\d*)$/.exec(value);
    if (!match || match.slice(1).some((part) => !Number.isSafeInteger(Number(part)))) fail('INVALID_VERSION');
    return match.slice(1).map(Number);
};
const newerThan = (next, current) => {
    const a = versionParts(next);
    const b = versionParts(current);
    for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return a[index] > b[index];
    return false;
};
const readSmallJson = async (filename) => {
    const stat = await fs.promises.lstat(filename);
    if (!stat.isFile() || stat.size > 65536) fail('INVALID_MANIFEST');
    return JSON.parse(await fs.promises.readFile(filename, 'utf8'));
};
const verifyManifest = (envelope, publicKey, currentVersion, appId) => {
    if (!envelope || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string' ||
        envelope.payload.length > 60000 || envelope.signature.length !== 88) fail('INVALID_MANIFEST');
    const payload = Buffer.from(envelope.payload, 'base64');
    if (!crypto.verify(null, payload, publicKey, Buffer.from(envelope.signature, 'base64'))) fail('INVALID_SIGNATURE');
    const value = JSON.parse(payload.toString('utf8'));
    if (value.schemaVersion !== 1 || value.appId !== appId || value.channel !== 'alpha' || value.platform !== 'win32' || value.arch !== 'x64') fail('WRONG_APPLICATION');
    if (!newerThan(value.version, currentVersion)) fail('NOT_NEWER');
    if (!value.dataSchemas || Object.keys(value.dataSchemas).length !== Object.keys(SCHEMAS).length ||
        Object.entries(SCHEMAS).some(([name, version]) => value.dataSchemas[name] !== version)) fail('UNSUPPORTED_DATA_SCHEMA');
    const filename = `Custom-Stremio-${value.version}-windows-x64-setup.exe`;
    if (value.installer?.filename !== filename || !Number.isSafeInteger(value.installer.size) ||
        value.installer.size < 2 || value.installer.size > 2 * 1024 ** 3 || !/^[a-f0-9]{64}$/.test(value.installer.sha256) ||
        !/^[a-f0-9]{40}$/.test(value.source) || !/^[a-f0-9]{64}$/.test(value.installed?.exeSha256) ||
        !/^[a-f0-9]{64}$/.test(value.installed?.asarSha256) || !/^[a-f0-9]{64}$/.test(value.installed?.launcherSha256)) fail('INVALID_MANIFEST');
    return value;
};
const signManifest = (value, privateKey) => {
    const payload = Buffer.from(JSON.stringify(value));
    return { payload: payload.toString('base64'), signature: crypto.sign(null, payload, privateKey).toString('base64') };
};
const digest = async (filename, signal) => {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filename, { signal })) hash.update(chunk);
    return hash.digest('hex');
};
const writeJson = async (filename, value) => {
    const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
    await fs.promises.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    await fs.promises.rename(temporary, filename);
};

class PersonalUpdater extends EventEmitter {
    constructor({ directory, publicKey, currentVersion, appId, launcherFile = path.join(__dirname, 'update-launcher.exe') }) {
        super();
        Object.assign(this, { directory: path.resolve(directory), publicKey, currentVersion, appId, launcherFile });
        this.state = { phase: 'idle', currentVersion };
        this.pending = null;
    }
    setState(value) {
        this.state = { ...value, currentVersion: this.currentVersion };
        this.emit('status', this.state);
        return this.state;
    }
    async initialize() {
        await fs.promises.mkdir(this.directory, { recursive: true });
        let found = false;
        try {
            const pending = await readSmallJson(path.join(this.directory, 'pending.json'));
            found = true;
            if (!/^[a-f0-9-]{36}$/.test(pending.id)) fail('INVALID_CACHE');
            const result = await readSmallJson(path.join(this.directory, pending.id, 'result.json')).catch(() => null);
            if (result) {
                const applied = result.phase === 'complete' && result.version === this.currentVersion;
                return this.setState({ phase: applied ? 'complete' : 'error', code: applied ? null : result.code || 'UPDATE_INTERRUPTED', version: result.version });
            }
            if (pending.installing) return this.setState({ phase: 'error', code: 'UPDATE_INTERRUPTED' });
            const envelope = await readSmallJson(path.join(this.directory, pending.id, 'update.json'));
            const manifest = verifyManifest(envelope, this.publicKey, this.currentVersion, this.appId);
            this.pending = { id: pending.id, manifest };
            await this.verifyPrepared();
            return this.setState({ phase: 'ready', version: manifest.version });
        } catch (error) {
            if (found || error.code !== 'ENOENT') this.setState({ phase: 'error', code: 'INVALID_CACHE' });
        }
        return this.state;
    }
    async prepare(filename) {
        if (this.busy || this.state.phase === 'installing') return this.state;
        this.busy = true;
        this.abort = new AbortController();
        let destination;
        this.setState({ phase: 'checking' });
        try {
            const envelope = await readSmallJson(filename);
            const manifest = verifyManifest(envelope, this.publicKey, this.currentVersion, this.appId);
            const source = path.join(path.dirname(filename), manifest.installer.filename);
            const stat = await fs.promises.lstat(source);
            if (!stat.isFile() || stat.size !== manifest.installer.size) fail('ARTIFACT_MISMATCH');
            const id = crypto.randomUUID();
            destination = path.join(this.directory, id);
            await fs.promises.mkdir(destination, { recursive: true });
            const partial = path.join(destination, 'installer.partial');
            const hash = crypto.createHash('sha256');
            let copied = 0;
            this.setState({ phase: 'copying', version: manifest.version, percent: 0 });
            await pipeline(fs.createReadStream(source), new Transform({ transform: (chunk, _encoding, callback) => {
                copied += chunk.length;
                if (copied > manifest.installer.size) { callback(Object.assign(new Error('ARTIFACT_MISMATCH'), { code: 'ARTIFACT_MISMATCH' })); return; }
                hash.update(chunk);
                const percent = Math.floor(copied * 100 / manifest.installer.size);
                if (percent !== this.state.percent) this.setState({ phase: 'copying', version: manifest.version, percent });
                callback(null, chunk);
            } }), fs.createWriteStream(partial, { flags: 'wx' }), { signal: this.abort.signal });
            if (copied !== manifest.installer.size || hash.digest('hex') !== manifest.installer.sha256) fail('ARTIFACT_MISMATCH');
            const header = await fs.promises.open(partial, 'r');
            try { const bytes = Buffer.alloc(2); await header.read(bytes, 0, 2, 0); if (bytes.toString() !== 'MZ') fail('ARTIFACT_MISMATCH'); }
            finally { await header.close(); }
            this.abort.signal.throwIfAborted();
            await fs.promises.rename(partial, path.join(destination, 'setup.exe'));
            await writeJson(path.join(destination, 'update.json'), envelope);
            await writeJson(path.join(this.directory, 'pending.json'), { id, installing: false });
            this.pending = { id, manifest };
            this.setState({ phase: 'ready', version: manifest.version });
        } catch (error) {
            // destination is a generated UUID directly beneath the fixed updater cache.
            if (destination && path.dirname(destination) === this.directory) await fs.promises.rm(destination, { recursive: true, force: true });
            this.setState({ phase: error.name === 'AbortError' ? 'idle' : 'error', code: error.name === 'AbortError' ? null : error.code || 'INVALID_MANIFEST' });
        } finally { this.busy = false; this.abort = null; }
        return this.state;
    }
    cancel() { this.abort?.abort(); }
    async verifyPrepared() {
        if (!this.pending) fail('NO_UPDATE');
        const directory = path.join(this.directory, this.pending.id);
        const envelope = await readSmallJson(path.join(directory, 'update.json'));
        const manifest = verifyManifest(envelope, this.publicKey, this.currentVersion, this.appId);
        const installer = path.join(directory, 'setup.exe');
        const stat = await fs.promises.lstat(installer);
        if (!stat.isFile() || stat.size !== manifest.installer.size || await digest(installer) !== manifest.installer.sha256) fail('ARTIFACT_MISMATCH');
        return { directory, installer, manifest };
    }
    async createHandoff({ installation, dataDirectory, executable, restartArgs = [] }) {
        const prepared = await this.verifyPrepared();
        const relative = path.relative(installation, dataDirectory);
        if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) fail('UNSAFE_DATA_LOCATION');
        const job = {
            schemaVersion: 1, parentPid: process.pid, installation, dataDirectory, executable,
            installer: prepared.installer, sha256: prepared.manifest.installer.sha256,
            installed: prepared.manifest.installed, version: prepared.manifest.version, restartArgs,
            backup: path.join(prepared.directory, 'previous-app'),
            dataBackup: path.join(dataDirectory, 'release-backups', this.pending.id),
            result: path.join(prepared.directory, 'result.json'), ready: path.join(prepared.directory, 'helper-ready.json')
        };
        await fs.promises.copyFile(path.join(__dirname, 'update-handoff.ps1'), path.join(prepared.directory, 'handoff.ps1'));
        const launcher = path.join(prepared.directory, 'update-launcher.exe');
        await fs.promises.copyFile(this.launcherFile, launcher);
        await writeJson(path.join(prepared.directory, 'job.json'), job);
        await writeJson(path.join(this.directory, 'pending.json'), { id: this.pending.id, installing: true });
        return { launcher, job: path.join(prepared.directory, 'job.json'), ready: job.ready };
    }
}
module.exports = { PersonalUpdater, verifyManifest, signManifest, newerThan, SCHEMAS, digest };

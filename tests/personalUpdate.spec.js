/* global test, expect, beforeEach, afterEach */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { PersonalUpdater, verifyManifest, signManifest, newerThan, SCHEMAS } = require('../desktop/personal-update.cjs');
const appId = 'io.github.f74dragon.customstremio';
const pair = crypto.generateKeyPairSync('ed25519');
let root;
let updater;
let manifest;
let envelope;
let selected;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-update-'));
    fs.mkdirSync(path.join(root, 'source'));
    const installer = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2 * 1024 * 1024, 42)]);
    manifest = {
        schemaVersion: 1, appId, version: '0.1.0-alpha.3', channel: 'alpha', platform: 'win32', arch: 'x64', dataSchemas: SCHEMAS,
        source: 'a'.repeat(40), installer: { filename: 'Custom-Stremio-0.1.0-alpha.3-windows-x64-setup.exe', size: installer.length, sha256: crypto.createHash('sha256').update(installer).digest('hex') },
        installed: { exeSha256: 'a'.repeat(64), asarSha256: 'b'.repeat(64), launcherSha256: 'c'.repeat(64) }
    };
    fs.writeFileSync(path.join(root, 'source', manifest.installer.filename), installer);
    envelope = signManifest(manifest, pair.privateKey);
    selected = path.join(root, 'source/update.json');
    fs.writeFileSync(selected, JSON.stringify(envelope));
    fs.writeFileSync(path.join(root, 'launcher.exe'), 'Synthetic helper fixture, never executed');
    updater = new PersonalUpdater({ directory: path.join(root, 'cache'), publicKey: pair.publicKey, currentVersion: '0.1.0-alpha.2', appId, launcherFile: path.join(root, 'launcher.exe') });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test('accepts the personal signer and rejects modified metadata or another signer', () => {
    expect(verifyManifest(envelope, pair.publicKey, '0.1.0-alpha.2', appId)).toEqual(manifest);
    const changed = { ...envelope, payload: Buffer.from(JSON.stringify({ ...manifest, version: '0.1.0-alpha.4' })).toString('base64') };
    expect(() => verifyManifest(changed, pair.publicKey, '0.1.0-alpha.2', appId)).toThrow('INVALID_SIGNATURE');
    expect(() => verifyManifest(envelope, crypto.generateKeyPairSync('ed25519').publicKey, '0.1.0-alpha.2', appId)).toThrow('INVALID_SIGNATURE');
});
test('rejects downgrades, equal versions, malformed or foreign builds and data migrations', () => {
    expect(newerThan('0.1.0-alpha.10', '0.1.0-alpha.2')).toBe(true);
    for (const [change, code] of [
        [{ version: '0.1.0-alpha.1' }, 'NOT_NEWER'], [{ version: '0.1.0-alpha.2' }, 'NOT_NEWER'],
        [{ version: '0.1.0' }, 'INVALID_VERSION'], [{ channel: 'latest' }, 'WRONG_APPLICATION'],
        [{ appId: 'org.stremio' }, 'WRONG_APPLICATION'], [{ arch: 'arm64' }, 'WRONG_APPLICATION'],
        [{ dataSchemas: { ...SCHEMAS, settings: 7 } }, 'UNSUPPORTED_DATA_SCHEMA'],
        [{ installer: { ...manifest.installer, filename: '../foreign.exe' } }, 'INVALID_MANIFEST'],
        [{ installer: { ...manifest.installer, size: 3 * 1024 ** 3 } }, 'INVALID_MANIFEST']
    ]) expect(() => verifyManifest(signManifest({ ...manifest, ...change }, pair.privateKey), pair.publicKey, '0.1.0-alpha.2', appId)).toThrow(code);
});
test('prepares an immutable verified cache, restores ready state after restart and rechecks before handoff', async () => {
    const states = [];
    updater.on('status', (state) => states.push(state.phase));
    expect(await updater.prepare(selected)).toMatchObject({ phase: 'ready', version: manifest.version });
    expect(states).toContain('copying');
    const restarted = new PersonalUpdater({ directory: updater.directory, publicKey: pair.publicKey, currentVersion: '0.1.0-alpha.2', appId });
    expect(await restarted.initialize()).toMatchObject({ phase: 'ready' });
    const prepared = await restarted.verifyPrepared();
    fs.writeFileSync(prepared.installer, 'MZ changed after preparation');
    await expect(restarted.createHandoff({ installation: path.join(root, 'app'), dataDirectory: path.join(root, 'data'), executable: 'unused' })).rejects.toMatchObject({ code: 'ARTIFACT_MISMATCH' });
    expect(fs.existsSync(path.join(prepared.directory, 'job.json'))).toBe(false);
});
test('copy cancellation never creates an installable partial artifact', async () => {
    updater.on('status', (state) => { if (state.phase === 'copying') updater.cancel(); });
    expect(await updater.prepare(selected)).toMatchObject({ phase: 'idle' });
    expect(updater.pending).toBeNull();
    expect(fs.readdirSync(updater.directory)).toEqual([]);
});
test('rejects mismatched installer bytes without installing or replacing a prepared update', async () => {
    fs.writeFileSync(path.join(root, 'source', manifest.installer.filename), Buffer.alloc(manifest.installer.size, 7));
    expect(await updater.prepare(selected)).toMatchObject({ phase: 'error', code: 'ARTIFACT_MISMATCH' });
    expect(updater.pending).toBeNull();
    expect(fs.existsSync(path.join(updater.directory, 'pending.json'))).toBe(false);
});
test('an interrupted handoff never automatically installs on startup', async () => {
    await updater.prepare(selected);
    const prepared = await updater.verifyPrepared();
    await updater.createHandoff({ installation: path.join(root, 'app'), dataDirectory: path.join(root, 'data'), executable: 'unused' });
    const restarted = new PersonalUpdater({ directory: updater.directory, publicKey: pair.publicKey, currentVersion: '0.1.0-alpha.2', appId });
    expect(await restarted.initialize()).toMatchObject({ phase: 'error', code: 'UPDATE_INTERRUPTED' });
    expect(JSON.parse(fs.readFileSync(path.join(prepared.directory, 'job.json'))).installer).toBe(prepared.installer);
});
test('refuses an installation that would include the user data/cache in its replaced files', async () => {
    await updater.prepare(selected);
    await expect(updater.createHandoff({ installation: root, dataDirectory: path.join(root, 'data'), executable: 'unused' })).rejects.toMatchObject({ code: 'UNSAFE_DATA_LOCATION' });
});

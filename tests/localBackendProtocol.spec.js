/* global describe, test, expect */

const {
    createBackendIdentity,
    checkBackendCompatibility,
    LOCAL_BACKEND_PROTOCOL_VERSION
} = require('../src/customStremio/localBackendProtocol');
const { checkDesktopBackendCompatibility } = require('../desktop/backend-compatibility.cjs');
const { version } = require('../local-backend/package.json');

const readyHealth = () => ({ ok: true, ...createBackendIdentity(version) });

describe('desktop backend compatibility', () => {
    test('accepts the bundled service and additive health fields/capabilities', () => {
        const health = readyHealth();
        health.downloads = { active: 2, queued: 1 };
        health.capabilities.push('future-optional-capability');
        expect(checkDesktopBackendCompatibility(health)).toEqual({ compatible: true, reason: null });
    });

    test.each([null, {}, { ok: true, service: 'some-other-service' }])('rejects an unrelated occupied port: %j', (health) => {
        expect(checkDesktopBackendCompatibility(health)).toEqual({ compatible: false, reason: 'different-service' });
    });

    test('rejects the old development backend without a protocol declaration', () => {
        expect(checkDesktopBackendCompatibility({ ok: true, service: readyHealth().service, version: 'dev' }))
            .toEqual({ compatible: false, reason: 'unsupported-protocol' });
    });

    test.each([0, LOCAL_BACKEND_PROTOCOL_VERSION + 1, String(LOCAL_BACKEND_PROTOCOL_VERSION), null])('rejects unsupported protocol %j', (protocolVersion) => {
        expect(checkDesktopBackendCompatibility({ ...readyHealth(), protocolVersion }))
            .toEqual({ compatible: false, reason: 'unsupported-protocol' });
    });

    test.each(['dev', '0.0.1', '99.0.0', undefined])('rejects an untested backend version %j', (backendVersion) => {
        expect(checkDesktopBackendCompatibility({ ...readyHealth(), version: backendVersion }))
            .toEqual({ compatible: false, reason: 'different-version' });
    });

    test.each([false, 'true', undefined])('requires explicit readiness: %j', (ok) => {
        expect(checkDesktopBackendCompatibility({ ...readyHealth(), ok }))
            .toEqual({ compatible: false, reason: 'not-ready' });
    });

    test.each([undefined, 'download-records-v1', [], ['download-records-v1', 'download-history-v1']])('rejects missing required capabilities: %j', (capabilities) => {
        expect(checkDesktopBackendCompatibility({ ...readyHealth(), capabilities }))
            .toEqual({ compatible: false, reason: 'missing-capabilities' });
    });

    test('does not let one health response mutate later capability declarations', () => {
        const health = readyHealth();
        health.capabilities.length = 0;
        expect(checkDesktopBackendCompatibility(readyHealth()).compatible).toBe(true);
    });

    test('requires callers to pin the backend package version', () => {
        expect(() => checkBackendCompatibility(readyHealth())).toThrow('expected backend package version');
    });
});

const LOCAL_BACKEND_SERVICE_NAME = 'custom-stremio-local-backend';
const LOCAL_BACKEND_PROTOCOL_VERSION = 1;
const DEFAULT_LOCAL_BACKEND_URL = 'http://127.0.0.1:5577';
const isLocalBackendUrl = (value) => {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' && url.hostname === '127.0.0.1' && /^\d+$/.test(url.port) &&
            Number(url.port) > 0 && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
    } catch { return false; }
};
const LOCAL_BACKEND_CAPABILITIES = Object.freeze([
    'download-records-v1',
    'download-history-v1',
    'mpc-hc-progress-v1'
]);

const createBackendIdentity = (version) => ({
    service: LOCAL_BACKEND_SERVICE_NAME,
    version,
    protocolVersion: LOCAL_BACKEND_PROTOCOL_VERSION,
    capabilities: [...LOCAL_BACKEND_CAPABILITIES]
});

// Compatibility is necessary for connecting, but never proves process ownership.
const checkBackendCompatibility = (health, expectedVersion) => {
    if (typeof expectedVersion !== 'string' || expectedVersion.length === 0) {
        throw new TypeError('An expected backend package version is required');
    }

    if (!health || typeof health !== 'object' || health.service !== LOCAL_BACKEND_SERVICE_NAME) {
        return { compatible: false, reason: 'different-service' };
    }
    if (health.ok !== true) {
        return { compatible: false, reason: 'not-ready' };
    }
    if (health.protocolVersion !== LOCAL_BACKEND_PROTOCOL_VERSION) {
        return { compatible: false, reason: 'unsupported-protocol' };
    }
    if (health.version !== expectedVersion) {
        return { compatible: false, reason: 'different-version' };
    }
    if (!Array.isArray(health.capabilities) || !LOCAL_BACKEND_CAPABILITIES.every((capability) => health.capabilities.includes(capability))) {
        return { compatible: false, reason: 'missing-capabilities' };
    }

    return { compatible: true, reason: null };
};

module.exports = {
    LOCAL_BACKEND_SERVICE_NAME,
    LOCAL_BACKEND_PROTOCOL_VERSION,
    LOCAL_BACKEND_CAPABILITIES,
    DEFAULT_LOCAL_BACKEND_URL,
    isLocalBackendUrl,
    createBackendIdentity,
    checkBackendCompatibility
};

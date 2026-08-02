const http = require('http');
const path = require('path');

const MPC_HC_HOST = '127.0.0.1';
const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const VALID_STATES = new Map([
    [0, 'stopped'],
    [1, 'paused'],
    [2, 'playing']
]);

class MpcHcStatusError extends Error {
    constructor(code, message, cause = null) {
        super(message);
        this.name = 'MpcHcStatusError';
        this.code = code;
        this.cause = cause;
    }
}

const normalizeMpcHcPort = (value) => {
    const port = Number(value);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
        throw new MpcHcStatusError('MPC_HC_PORT_INVALID', 'MPC-HC Web Interface port must be between 1 and 65535');
    }
    return port;
};

const decodeHtmlText = (value) => String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .trim();

const extractVariable = (html, id) => {
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`<p\\b[^>]*\\bid\\s*=\\s*["']${escapedId}["'][^>]*>([\\s\\S]*?)<\\/p>`, 'i');
    const match = pattern.exec(html);
    return match ? decodeHtmlText(match[1]) : null;
};

const parseNonNegativeInteger = (value, fieldName) => {
    if (!/^\d+$/.test(String(value || ''))) {
        throw new MpcHcStatusError('MPC_HC_RESPONSE_INVALID', `MPC-HC returned an invalid ${fieldName}`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new MpcHcStatusError('MPC_HC_RESPONSE_INVALID', `MPC-HC returned an invalid ${fieldName}`);
    }
    return parsed;
};

const parseMpcHcVariables = (html) => {
    if (typeof html !== 'string' || html.length === 0) {
        throw new MpcHcStatusError('MPC_HC_RESPONSE_INVALID', 'MPC-HC returned an empty Web Interface response');
    }

    const stateValue = parseNonNegativeInteger(extractVariable(html, 'state'), 'playback state');
    const state = VALID_STATES.get(stateValue);
    if (!state) {
        throw new MpcHcStatusError('MPC_HC_RESPONSE_INVALID', 'MPC-HC returned an unsupported playback state');
    }

    return {
        state,
        stateCode: stateValue,
        positionMs: parseNonNegativeInteger(extractVariable(html, 'position'), 'playback position'),
        durationMs: parseNonNegativeInteger(extractVariable(html, 'duration'), 'duration'),
        filePath: extractVariable(html, 'filepath') || null
    };
};

const normalizeWindowsMediaPath = (value) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
        return null;
    }
    let candidate = value.trim().replace(/\//g, '\\');
    if (candidate.toLowerCase().startsWith('\\\\?\\unc\\')) {
        candidate = `\\\\${candidate.slice(8)}`;
    } else if (candidate.startsWith('\\\\?\\')) {
        candidate = candidate.slice(4);
    }
    if (!path.win32.isAbsolute(candidate)) {
        return null;
    }
    return path.win32.normalize(candidate).toLowerCase();
};

const isSameWindowsMediaPath = (firstPath, secondPath) => {
    const first = normalizeWindowsMediaPath(firstPath);
    const second = normalizeWindowsMediaPath(secondPath);
    return first !== null && second !== null && first === second;
};

class MpcHcStatusClient {
    constructor({
        request = http.request,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES
    } = {}) {
        this.request = request;
        this.timeoutMs = timeoutMs;
        this.maxResponseBytes = maxResponseBytes;
    }

    async getStatus(port) {
        const normalizedPort = normalizeMpcHcPort(port);
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (callback, value) => {
                if (settled) {
                    return;
                }
                settled = true;
                callback(value);
            };
            const request = this.request({
                protocol: 'http:',
                hostname: MPC_HC_HOST,
                port: normalizedPort,
                path: '/variables.html',
                method: 'GET',
                agent: false,
                headers: {
                    Accept: 'text/html',
                    Connection: 'close'
                }
            }, (response) => {
                if (response.statusCode !== 200) {
                    response.resume();
                    finish(reject, new MpcHcStatusError(
                        'MPC_HC_HTTP_ERROR',
                        `MPC-HC Web Interface returned HTTP ${response.statusCode || 'unknown'}`
                    ));
                    return;
                }

                const chunks = [];
                let responseBytes = 0;
                response.on('data', (chunk) => {
                    responseBytes += chunk.length;
                    if (responseBytes > this.maxResponseBytes) {
                        response.destroy();
                        finish(reject, new MpcHcStatusError(
                            'MPC_HC_RESPONSE_TOO_LARGE',
                            'MPC-HC Web Interface response exceeded the safety limit'
                        ));
                        return;
                    }
                    chunks.push(chunk);
                });
                response.once('error', (error) => {
                    finish(reject, new MpcHcStatusError(
                        'MPC_HC_REQUEST_FAILED',
                        'Could not read the MPC-HC Web Interface response',
                        error
                    ));
                });
                response.once('end', () => {
                    if (settled) {
                        return;
                    }
                    try {
                        finish(resolve, parseMpcHcVariables(Buffer.concat(chunks).toString('utf8')));
                    } catch (error) {
                        finish(reject, error instanceof MpcHcStatusError ? error : new MpcHcStatusError(
                            'MPC_HC_RESPONSE_INVALID',
                            'Could not parse the MPC-HC Web Interface response',
                            error
                        ));
                    }
                });
            });

            request.setTimeout(this.timeoutMs, () => {
                request.destroy();
                finish(reject, new MpcHcStatusError(
                    'MPC_HC_REQUEST_TIMEOUT',
                    'MPC-HC Web Interface did not respond in time'
                ));
            });
            request.once('error', (error) => {
                finish(reject, new MpcHcStatusError(
                    'MPC_HC_REQUEST_FAILED',
                    `Could not connect to MPC-HC at ${MPC_HC_HOST}:${normalizedPort}`,
                    error
                ));
            });
            request.end();
        });
    }
}

module.exports = {
    MPC_HC_HOST,
    DEFAULT_TIMEOUT_MS,
    DEFAULT_MAX_RESPONSE_BYTES,
    MpcHcStatusError,
    normalizeMpcHcPort,
    parseMpcHcVariables,
    normalizeWindowsMediaPath,
    isSameWindowsMediaPath,
    MpcHcStatusClient
};

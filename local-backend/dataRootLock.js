const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');

const getLockAddress = (dataRoot, platform = process.platform) => {
    const canonical = platform === 'win32' ? dataRoot.toLowerCase() : dataRoot;
    const digest = crypto.createHash('sha256').update(canonical).digest('hex');
    return platform === 'win32' ?
        `\\\\.\\pipe\\custom-stremio-data-${digest}` :
        { host: '127.0.0.1', port: 20000 + parseInt(digest.slice(0, 8), 16) % 30000, exclusive: true };
};

// OS-owned listeners disappear on process exit, including crashes; no stale PID files.
const acquireDataRootLock = async (dataRoot) => {
    fs.mkdirSync(dataRoot, { recursive: true });
    const canonical = fs.realpathSync(path.resolve(dataRoot));
    const server = net.createServer((socket) => socket.destroy());
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(getLockAddress(canonical), resolve);
        });
    } catch (cause) {
        const error = new Error('This data folder is already in use. Close its other Custom Stremio app or terminal backend, then retry.');
        error.code = 'DATA_ROOT_IN_USE';
        error.cause = cause;
        throw error;
    }
    let released = false;
    return {
        release: () => {
            if (released) return Promise.resolve();
            released = true;
            return new Promise((resolve) => server.close(resolve));
        }
    };
};

module.exports = { getLockAddress, acquireDataRootLock };

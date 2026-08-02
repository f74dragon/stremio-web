const net = require('net');

const findAvailableMpcHcPort = (preferredPort) => new Promise((resolve, reject) => {
    const firstPort = Number.isSafeInteger(preferredPort) ? preferredPort + 1 : 13580;
    let candidate = firstPort;
    const tryPort = () => {
        const server = net.createServer();
        server.once('error', () => {
            candidate += 1;
            if (candidate > firstPort + 20) {
                reject(new Error('Could not reserve a local MPC-HC telemetry port'));
                return;
            }
            tryPort();
        });
        server.listen({ host: '127.0.0.1', port: candidate }, () => {
            server.close((error) => error ? reject(error) : resolve(candidate));
        });
    };
    tryPort();
});

module.exports = { findAvailableMpcHcPort };

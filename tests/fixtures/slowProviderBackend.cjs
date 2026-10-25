require('./isolatedManagedBackend.cjs');
const { RealDebridClient } = require('../../local-backend/realDebridClient');
RealDebridClient.prototype.refreshAccessToken = async () => {
    process.send({ type: 'test-provider-started' });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    process.send({ type: 'test-provider-finished' });
    throw new Error('Synthetic offline provider');
};

const { version } = require('../local-backend/package.json');
const { checkBackendCompatibility } = require('../src/customStremio/localBackendProtocol');

// Until rolling compatibility is explicitly tested, require the bundled backend version.
const checkDesktopBackendCompatibility = (health) => checkBackendCompatibility(health, version);

module.exports = { checkDesktopBackendCompatibility };

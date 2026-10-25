// Tests own temporary data folders and must not depend on a developer's port 5577.
// The real legacy probe is tested independently against an isolated HTTP server.
require('../../local-backend/managedAccess').assertNoLegacyBackend = async () => { /* Isolated test data only. */ };

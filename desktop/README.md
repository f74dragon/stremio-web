# Custom Stremio desktop foundation

Phase 1 defines the release contract and shared helpers. There is no Electron
launcher, installed application, installer, or update delivery yet. No desktop
runtime dependency is installed by this directory.

- `package.json`: fork desktop version and product name, independent of the
  upstream web version in the repository-root package.
- `release-config.json`: stable application ID, executable name, renderer origin,
  prerelease channel, and proposed release repository. This is configuration for
  the future launcher/packager; it does not register a protocol or enable updates.
- `data-paths.cjs`: pure resolution of persistent backend, desktop profile/session,
  log, and upgrade-backup directories. It shares the existing backend resolver.
- `backend-compatibility.cjs`: checks the health response against the bundled
  backend package version and shared protocol/capabilities. A compatible response
  does not prove ownership or authorize shutdown, reuse, or privileged actions.

Run `pnpm verify:release` from the repository root to check the foundation and
print component versions, source HEAD/dirty status, and the vendored Core digest.
`pnpm verify:release --require-clean` additionally rejects an uncommitted source
tree. Neither command builds, publishes, starts services, nor touches user data.
The foundation check alone does not establish that an application is release-ready.

See [the Windows release contract](../docs/CUSTOM_STREMIO_WINDOWS_RELEASE.md) and
[the upstream audit/workflow](../docs/CUSTOM_STREMIO_UPSTREAM_UPDATES.md) before
implementing the launcher.

# Release runbook

1. Use the Node version in `.node-version` and run `npm ci`.
2. Run `npm test`, `npm audit --omit=dev`, and `npm run build:server`.
3. Commit all source changes; the release builder refuses dirty trees.
4. Set `SERVERHUB_RELEASE_VERSION` to the package version and run `npm run dist:win:portable`.
5. Run `npm run sbom`, extract the ZIP into a clean directory, and run `scripts/validate-package.mjs` against its server bundle.
6. Validate PE subsystem 2 and native-shell lifecycle on Windows.
7. Publish the ZIP, SHA256SUMS, release manifest, and SBOM together.

Never replace a historical release artifact; publish a new version.

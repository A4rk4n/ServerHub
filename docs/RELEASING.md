# Release checklist

1. Use the assigned release branch and require a clean tracked tree.
2. Update package version and release notes.
3. Run Node 24 typecheck, lint, security, migration, installation-job, watchdog, production build, package-integrity, release-verification, and production-audit checks.
4. Build the native Windows GUI launcher; confirm it embeds WebView2 and does not open a browser or console.
5. Extract the portable package into a clean directory and rerun integrity checks there.
6. Confirm management binds only to loopback and child processes remain hidden.
7. Generate build information, SHA-256 manifest, release manifest, and CycloneDX SBOM.
8. Verify every listed checksum independently.
9. Smoke-test install, start, readiness, stop, backup, restore preview, diagnostics, and graceful window close on Windows.
10. Upload without replacing historical artifacts. Make only the intended new file public.
11. Record artifact size, SHA-256, SBOM checksum, source commit, and download URL.

Never package databases, credentials, worlds, logs, `node_modules`, source build caches, or private configuration.

## Build versus promotion

- **Build** happens in CI: the `windows-portable` job produces the ZIP,
  `SHA256SUMS`, `release-manifest.json`, and the SBOM, and uploads them as the
  `ServerHub-Windows-x64` workflow artifact of that run. A tag must point at a
  commit that passed CI on `main`.
- **Promotion** happens through the manual **Promote release** workflow: it
  takes only a tag and a CI run ID, re-verifies the artifact (version,
  filename, source commit, embedded provenance, size, SHA-256, SBOM checksum)
  against the tagged source, and attaches the exact CI-built bytes to the
  release without rebuilding. It never accepts a file path.
- Publish as a draft first, review, then publish. The workflow refuses to
  overwrite an existing asset.

## Artifact provenance

- `release-manifest.json` records the artifact name, size, SHA-256, source
  commit, the checksum of the `build-info.json` embedded inside the ZIP, and
  the SBOM name and checksum.
- `build-info.json` inside the ZIP records the version, source commit, clean
  source state, build epoch, Node/npm versions, target platform, and the
  `package-lock.json` checksum. The promotion workflow requires all of these
  to agree with the tag.
- Users verify a download with `sha256sum -c SHA256SUMS` before running
  `ServerHub.exe`.

## Windows smoke-test signoff

Before publishing (removing draft status), a real Windows machine must pass
the smoke test: native WebView2 window with no browser or console, an
end-to-end installation (for example Dragonwilds via SteamCMD), visible
"Open folder" behavior, and graceful shutdown of the service and managed
processes on window close. Record machine, date, tester, and result in the
release notes.

## Rollback and superseded artifacts

- Never modify, overwrite, or delete published assets or historical releases.
- Supersede a bad artifact with the next patch release; mark the old release
  as superseded in its notes and point to the replacement.
- Users roll back by installing the previous portable release; data under
  `%APPDATA%\ServerHub` is retained.
- A failed or interrupted promotion can be re-dispatched: identical
  already-attached assets are skipped; any digest mismatch aborts.

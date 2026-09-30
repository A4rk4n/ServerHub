# Releasing Server Hub

This is the canonical release guide for Server Hub. It documents the full
build-versus-promotion model, every verification condition, artifact
provenance, smoke-test signoff, and rollback policy. [`RELEASE.md`](../RELEASE.md)
at the repository root is the condensed operator runbook for executing a
release; it links back here instead of duplicating this material.

Server Hub separates **building** a release artifact from **promoting** it to
a GitHub release. Artifacts are built once by CI and published without
rebuilding, so the exact bytes that were tested are the exact bytes that ship.

## Release checklist

1. Use the assigned release branch and require a clean tracked tree.
2. Update the package version and release notes: bump `package.json` and
   `package-lock.json` (`npm version <X.Y.Z> --no-git-tag-version`) and add the
   `CHANGELOG.md` entry following Keep a Changelog conventions.
3. Run the verification gate on the pinned toolchain (Node 24 via
   [`.node-version`](../.node-version), npm 10): `npm ci`,
   `npm run build:server`, `npm test` (typecheck, lint, and every test suite
   through the native Node test runner — the parallel `test:unit` pass plus
   the installation-job lifecycle integration), and the production audit
   `npm audit --omit=dev`.
4. Build the native Windows GUI launcher (`npm run dist:win:portable`);
   confirm it embeds WebView2 and does not open a browser or console.
5. Extract the portable package into a clean directory and rerun integrity
   checks there (`node scripts/validate-package.mjs <extracted>/ServerHub/resources/server`).
6. Confirm management binds only to loopback and child processes remain hidden.
7. Generate build information, SHA-256 manifest, release manifest, and
   CycloneDX SBOM (CI produces these for the official artifact).
8. Verify every listed checksum independently.
9. Smoke-test install, start, readiness, stop, backup, restore preview,
   diagnostics, and graceful window close on Windows (see
   [Windows smoke-test signoff](#windows-smoke-test-signoff)).
10. Upload without replacing historical artifacts. Make only the intended new
    file public.
11. Record artifact size, SHA-256, SBOM checksum, source commit, and download
    URL.

Never package databases, credentials, worlds, logs, `node_modules`, source
build caches, or private configuration.

## Build (automated, per commit)

- CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs the
  Ubuntu and Windows test matrices, `npm audit --omit=dev`, the Windows
  portable build, PE GUI-subsystem validation, package-integrity checks,
  release-verification regression, and SBOM generation for every pull request
  and for pushes to `main` and `v*` tags.
- The `windows-portable` job uploads the exact ZIP it built, together with
  `SHA256SUMS`, `release-manifest.json`, and the CycloneDX SBOM, as the
  `ServerHub-Windows-x64` workflow artifact. Only artifacts produced by a
  successful CI run of this repository are publishable; there is no path that
  publishes a locally built ZIP.

A release tag must point at a commit that passed CI on `main`.

## Promotion (manual, no rebuild)

1. Push the semantic version tag pointing at the green `main` commit.
2. Dispatch the **Promote release** workflow
   ([`.github/workflows/promote-release.yml`](../.github/workflows/promote-release.yml))
   from `main` with the tag and the ID of the successful CI run that built the
   artifact.
3. The workflow verifies — and refuses to publish unless everything matches:
   the tag resolves to a commit on `main`; the CI run belongs to this
   repository's CI workflow, completed successfully, and built that exact
   commit; the package version at the tag matches the tag; the artifact
   filename matches the version; the artifact size and SHA-256 match
   `SHA256SUMS` and `release-manifest.json`; the `build-info.json` embedded in
   the ZIP records the same version, the same source commit, a clean source
   tree, and the win32/x64 target; and the SBOM checksum matches. The bundle
   is downloaded from the referenced CI run only — no file paths are accepted.
4. Promotion defaults to creating a **draft** release. Review the draft, then
   publish it. Prerelease marking is a workflow input. The workflow refuses to
   overwrite an existing asset.
5. Record the artifact size, SHA-256, source commit, SBOM checksum, and the CI
   run that built the artifact.

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

## Local verification

- Use the Node version in [`.node-version`](../.node-version) and run
  `npm ci`, `npm run build:server`, `npm test`, and `npm audit --omit=dev`.
  `npm test` drives the native Node test runner; `npm run test:unit` alone
  skips the POSIX-only installation-job lifecycle integration (useful on
  Windows), and every `npm run test:<suite>` script runs one suite in
  isolation for focused debugging.
- To check an arbitrary artifact locally:
  `node scripts/verify-release-artifact.mjs --artifact <zip> --manifest <release-manifest.json> --sums <SHA256SUMS> --tag <vX.Y.Z> --commit <sha> [--sbom <sbom.cdx.json>]`
  from the tagged checkout. It performs the same identity, provenance, and
  checksum checks as the promotion workflow.
- Users verify a downloaded release ZIP with `sha256sum -c SHA256SUMS`.

## Windows smoke-test signoff

Before publishing a release (removing draft status), confirm on real Windows:

- Extract the portable ZIP into a clean folder and launch `ServerHub.exe`.
- The native WebView2 window opens; no browser, app-mode window, or Command
  Prompt appears.
- An installation works end to end (for example Dragonwilds through SteamCMD).
- An explicit "Open folder" action shows a visible, persistent File Explorer
  window.
- Closing the window gracefully stops the management service and managed
  processes.
- `npm audit --omit=dev` (production dependencies) reports zero
  vulnerabilities.

Record the signoff (machine, date, tester, and checklist result) in the
release notes.

## Rollback and superseded artifacts

- Never modify, overwrite, or delete a published asset or a historical
  release. If an artifact must stop being used, supersede it: publish the next
  patch release, mark the old release as superseded in its notes with a
  pointer to the replacement, and — only if the artifact is actively harmful —
  ask GitHub Support to remove it.
- Users roll back by installing the previous portable release; application
  data under `%APPDATA%\ServerHub` survives replacement.
- A failed or interrupted promotion can be re-dispatched: already-attached
  assets with identical digests are skipped, and any digest mismatch aborts
  without touching the release.

Never replace a historical release artifact; publish a new version.

## Related documents

- [`RELEASE.md`](../RELEASE.md) — condensed operator runbook for executing a
  release.
- [Architecture overview](ARCHITECTURE.md)
- [Provider integration guide](PROVIDER-INTEGRATION.md)
- [Troubleshooting](TROUBLESHOOTING.md)

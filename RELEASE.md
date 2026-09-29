# Release runbook

Server Hub separates **building** a release artifact from **promoting** it to a
GitHub release. Artifacts are built once by CI and published without
rebuilding, so the exact bytes that were tested are the exact bytes that ship.

## Build (automated, per commit)

1. CI (`.github/workflows/ci.yml`) runs the Ubuntu and Windows test matrices,
   `npm audit --omit=dev`, the Windows portable build, PE GUI-subsystem
   validation, package-integrity checks, release-verification regression, and
   SBOM generation for every pull request and for pushes to `main` and `v*`
   tags.
2. The `windows-portable` job uploads the exact ZIP it built, together with
   `SHA256SUMS`, `release-manifest.json`, and the CycloneDX SBOM, as the
   `ServerHub-Windows-x64` workflow artifact. Only artifacts produced by a
   successful CI run of this repository are publishable; there is no path that
   publishes a locally built ZIP.

A release tag must point at a commit that passed CI on `main`.

## Promotion (manual, no rebuild)

1. Dispatch the **Promote release** workflow from `main` with the tag and the
   ID of the successful CI run that built the artifact.
2. The workflow verifies — and refuses to publish unless everything matches:
   the tag resolves to a commit on `main`; the CI run belongs to this
   repository's CI workflow, completed successfully, and built that exact
   commit; the package version at the tag matches the tag; the artifact
   filename matches the version; the artifact size and SHA-256 match
   `SHA256SUMS` and `release-manifest.json`; the `build-info.json` embedded in
   the ZIP records the same version, the same source commit, a clean source
   tree, and the win32/x64 target; and the SBOM checksum matches. The bundle
   is downloaded from the referenced CI run only — no file paths are accepted.
3. Promotion defaults to creating a **draft** release. Review the draft, then
   publish it. Prerelease marking is a workflow input.
4. Record the artifact size, SHA-256, source commit, SBOM checksum, and the CI
   run that built the artifact.

## Local verification

- Use the Node version in `.node-version` and run `npm ci`, `npm test`,
  `npm audit --omit=dev`, and `npm run build:server`.
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
- A failed promotion can be re-dispatched: already-attached assets with
  identical digests are skipped, and any digest mismatch aborts without
  touching the release.

Never replace a historical release artifact; publish a new version.

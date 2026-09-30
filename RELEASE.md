# Release runbook

Condensed operator checklist for shipping a Server Hub release.
[`docs/RELEASING.md`](docs/RELEASING.md) is the canonical release guide — it
documents the full build-versus-promotion model, verification conditions,
artifact provenance, smoke-test signoff, and rollback policy. This runbook is
the quick path through a release and links into that guide instead of
repeating it.

Server Hub separates **building** a release artifact from **promoting** it:
CI builds and validates the artifact once, and promotion publishes the exact
tested bytes without rebuilding.

## Before you start

- Work on the assigned release branch with a clean tracked tree. Bump
  `package.json`/`package-lock.json` and update `CHANGELOG.md`.
- Use the Node version in [`.node-version`](.node-version) (Node 24) with
  npm 10.
- Gate the release locally:

  ```bash
  npm ci
  npm run build:server
  npm test                 # typecheck, lint, and every test suite
  npm audit --omit=dev     # must report zero vulnerabilities
  ```

  The installation-job lifecycle integration runs natively on both Linux
  and Windows; every `npm run test:<suite>` script runs one suite in
  isolation for focused debugging.

## Ship it

1. Confirm the commit to release passed CI on `main`, and that the
   `windows-portable` job uploaded the `ServerHub-Windows-x64` artifact (ZIP,
   `SHA256SUMS`, `release-manifest.json`, CycloneDX SBOM). Only CI-built
   bytes are publishable — never upload a locally built ZIP.
2. Complete the
   [Windows smoke-test signoff](docs/RELEASING.md#windows-smoke-test-signoff)
   on real hardware and record machine, date, tester, and result.
3. Push the semantic tag (for example `v2.13.0`) pointing at the green `main`
   commit.
4. Dispatch the **Promote release** workflow from `main` with the tag and the
   ID of the CI run that built the artifact. It re-verifies provenance,
   checksums, and the embedded build record, and refuses to publish on any
   mismatch. Leave the draft option enabled, review the draft release, then
   publish it.
5. Record artifact size, SHA-256, source commit, SBOM checksum, CI run ID,
   and download URL in the release notes.

## If something goes wrong

- A failed or interrupted promotion can be re-dispatched with the same
  inputs: identical already-attached assets are skipped and any digest
  mismatch aborts without touching the release.
- Never modify, overwrite, or delete a published asset or a historical
  release. Supersede a bad artifact with the next patch release and mark the
  old release as superseded; users roll back by installing the previous
  portable ZIP (application data under `%APPDATA%\ServerHub` survives
  replacement).

Details for every step: [build vs. promotion](docs/RELEASING.md#build-automated-per-commit),
[promotion checks](docs/RELEASING.md#promotion-manual-no-rebuild),
[artifact provenance](docs/RELEASING.md#artifact-provenance),
[local verification](docs/RELEASING.md#local-verification),
[rollback policy](docs/RELEASING.md#rollback-and-superseded-artifacts).

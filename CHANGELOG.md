# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.24.0] - 2026-09-30

### Added
- Webhook notifications for fleet events: configure a webhook URL (Tool Health page) and Server Hub reports servers coming online, stopping, or crashing (with exit details), automatic-restart scheduling and limit exhaustion, and backup outcomes — each group individually toggleable. Discord webhook URLs are detected and receive ready-to-read messages with @-mentions suppressed; any other http(s) endpoint receives structured JSON. A send-test button verifies delivery end to end. Delivery is bounded and best-effort — a dead webhook never slows down or breaks server management — and the configuration lives in a restricted-permission local file that is excluded from support bundles, since Discord webhook URLs embed a capability token.

## [2.23.0] - 2026-09-30

### Added
- Palworld graceful stop through the official REST API: stopping or restarting a Palworld server now saves the world and requests a shutdown with a 10-second in-game countdown over the loopback-only REST API (Basic auth with the server's admin password), instead of force-killing a process that ignores stdin — eliminating the routine risk of world-save corruption. The managed `PalWorldSettings.ini` enables the REST API automatically when an admin password is set, on a per-server port derived from the game port (8211 → 8212); the port is never exposed or given a firewall rule. If the API declines — no admin password, or an older server build — the previous termination path with its 30-second force-kill backstop still applies, and the console explains what happened.

## [2.22.0] - 2026-09-30

### Added
- In-app update notification: Server Hub checks GitHub Releases (bounded lookup, cached six hours; failures cached ten minutes and never surfaced as errors) and shows a dismissible banner when a newer published release exists, with a link to the release page. Dismissing hides that specific version and re-arms for the next release; a mute control opts out of checks entirely (per browser) and can be re-enabled from the sidebar footer. Only published, non-prerelease versions with strict semver tags are ever surfaced.

### Fixed
- The sidebar footer displayed a hardcoded, stale version string (`v1.0.2`); it now shows the actual running version.

## [2.21.0] - 2026-09-30

### Added
- Console search and export: a search box in the console toolbar filters the stream case-insensitively across message text and source tags, composes with the existing severity pills (the warn pill still includes errors), and shows a live match counter; a new download button exports exactly the visible slice — filtered and searched — as a timestamped per-server `.log` file. Empty states now distinguish "no matches" from "no output yet". The filtering and export logic lives in a pure module covered by a dedicated unit suite.

## [2.20.0] - 2026-09-30

### Added
- Palworld dedicated-server provider: installed anonymously through SteamCMD (app `2394010`) with the staged, recoverable installation pipeline, launched through the official `PalServer` launcher with `-port` and `-players`, and covered by the 15-second Unreal Engine process-stability readiness window. Palworld has no bind-address launch flag (the server listens on every interface), so managed settings — server name, player cap, public port, join and admin passwords, RCON disabled — are written to `Pal/Saved/Config/<platform>/PalWorldSettings.ini` (mode 0600, quote-safe values) before every launch; settings not managed by Server Hub keep the game's defaults.

## [2.19.0] - 2026-09-30

### Added
- Packaged-app boot smoke test in CI: the Windows portable job now boots the exact server bundle extracted from the shipped ZIP, waits for `/api/health` to report a healthy runtime and database, verifies the game catalog is served, and then exercises the native launcher's graceful-shutdown path (`serverhub:shutdown`), requiring a clean self-driven exit — a regression gate that catches packaging defects a static file-list validation cannot (missing runtime modules, broken Next standalone output, database bootstrap failures). Also runnable locally via `npm run smoke:package` (defaults to `build/server`).

## [2.18.0] - 2026-09-30

### Added
- Scheduled `prune` task type: applies the server's backup retention limits on a schedule through the same enforcement path as automatic pruning. Runs are recorded in the task history — including a skipped run with a hint when no retention limits are configured — and the outcome (backups removed, backups kept) is logged to the server console.
- Backups tab retention controls: the header now shows the active retention policy (`keep N · max Dd`, or `retention off`), a **Prune now** button applies the limits on demand and reports how many backups were removed, and the pre-update safety backup is marked with a shield badge to show it is protected from pruning. `GET /api/servers/:id/backups` now returns the retention policy alongside the backup list.

### Fixed
- Maintenance tasks can now actually be created: the scheduler executed the `maintenance` task type and the task form offered it, but the tasks API rejected it, so creating one silently failed.

## [2.17.0] - 2026-09-30

### Added
- Satisfactory dedicated-server provider: installed anonymously through SteamCMD (app `1690800`) with the existing staged, recoverable installation pipeline, launched through the official `FactoryServer` launcher with `-multihome` LAN binding and `-unattended` operation, validated after installation, and covered by the 15-second Unreal Engine process-stability readiness window.

## [2.16.0] - 2026-09-30

### Added
- Configurable backup retention per server: keep at most N completed backups and/or delete completed backups older than D days (0 disables a limit; both default to 0, preserving existing unlimited behavior). Retention runs automatically after every completed backup — manual, scheduled, and update backups alike — and can be triggered on demand (`POST /api/servers/:id/backups {"action":"prune"}`). The active pre-update safety backup and in-progress or failed backup records are never pruned. Settings are exposed in the server Settings UI, carried by clones and templates, and enforced with clamped ranges (count 0–100, age 0–365 days).

### Changed
- Additive schema migration 21600 adds `backup_retention_count` and `backup_retention_days` to the `servers` table; the migration worker and version assertions now track `SCHEMA_VERSION` instead of a hardcoded version.

## [2.15.0] - 2026-09-30

### Added
- Automated release notes: the release promotion workflow now extracts the tagged version's `CHANGELOG.md` section (`scripts/release-notes.mjs`) and publishes it ahead of the verified provenance block, instead of provenance-only notes.
- Release-metadata consistency gate: `node scripts/release-notes.mjs check` verifies that `package.json`, `package-lock.json`, and `CHANGELOG.md` agree on the current version (dated entry, non-empty body, link definitions). CI enforces it on every commit, promotion enforces it against the tagged source, and the unit suite asserts it locally.

### Fixed
- Release-note assembly in the promotion workflow no longer uses an unquoted heredoc, which would have executed backticks in changelog text as shell command substitutions.

## [2.14.0] - 2026-09-30

### Added
- The installation-job lifecycle integration (`npm run test:installation-jobs`) now runs natively on Windows: CI executes all 7 lifecycle tests on both `ubuntu-26.04` and `windows-2025` instead of gating the suite to POSIX and relying on the portable-package job for indirect Windows coverage.

### Fixed
- Launch-argument parsing no longer treats backslash as a POSIX escape character on Windows, where it is the path separator; launch arguments containing paths such as `C:\servers\world` now pass through literally instead of losing their separators.
- The port-conflict test fixture binds the exact address the installation preflight probes, making UDP conflict detection deterministic on Windows, which permits specific-address binds alongside foreign wildcard binds.

## [2.13.1] - 2026-09-30

### Changed
- Adopt the safe members of the weekly Dependabot npm group (drizzle-orm 0.45.3, Next.js/eslint-config-next 16.3.7, React 19.3.0 with matching types, framer-motion 13.4.6, lucide-react 1.49.0, Tailwind CSS 4.3.3, tsx 4.23.15, `@types/yauzl` 3.4.0) and move `@types/node` to the 24.x line matching the pinned Node 24 runtime. TypeScript stays at 5.9.3: the grouped Dependabot PR is unmergeable because `typescript@7` conflicts with `@typescript-eslint/parser`'s peer range (`>=4.8.4 <6.1.0`) and fails `npm ci`.
- Configure Dependabot to ignore TypeScript and `@types/node` major updates so one unmergeable major no longer poisons the whole weekly npm group.
- Bound every CI and release-promotion job with `timeout-minutes` so hung steps fail fast instead of consuming the six-hour default.

### Added
- Dependency-free Markdown link checker (`scripts/check-docs.mjs`) validating relative links and GitHub-slug anchors across all tracked documentation, with a dedicated unit suite in the parallel `test:unit` pass.
- New `docs` CI job enforcing the Markdown link check, workflow YAML parsing, and shell-script syntax checks that were previously manual pre-push steps.

## [2.13.0] - 2026-09-30

### Changed
- Migrate all 37 test suites to Node 24's built-in test runner (`node --test` with `node:test` and `node:assert`): test files execute in parallel in isolated processes with per-test names, durations, and a structured pass/fail summary, replacing the fragile 37-step `&&` chain that halted on the first failure.
- `npm test` now runs typecheck, lint, the parallel `test:unit` pass, and the installation-job lifecycle integration; every `npm run test:<suite>` script still runs a single suite in isolation for focused debugging.
- CI executes the full test suite through the native runner on both `ubuntu-26.04` and `windows-2025` (the POSIX-only installation-job lifecycle integration remains Linux-gated and covered on Windows by the portable-package job), and surfaces failing-test summaries as check annotations so failures are visible without downloading log archives.
- Consolidate release documentation: `docs/RELEASING.md` is now the canonical release guide covering build versus promotion, provenance, smoke-test signoff, and rollback, while `RELEASE.md` becomes a concise operator runbook that links into it.

### Fixed
- Wire the `test:catalog` and `test:recovery-invariants` suites into the default test run; both existed and passed but were never invoked by `npm test`.

## [2.12.0] - 2026-09-30

Repository accuracy and dependency hygiene. Infrastructure-only release with no runtime changes; intentionally left untagged.

### Changed
- Pin Windows CI runner image to `windows-2025`.
- Add Dependabot configuration for npm and GitHub Actions with weekly schedules and grouped updates.
- Archive v1.3 recovery records (`HANDOFF.md`, `SOURCE-MANIFEST.json`) under `docs/history/`.
- Rewrite `README.md` to accurately document the native WebView2 Windows portable application, Node 24 requirement, and supported scripts.
- Remove obsolete `"main": "electron/main.cjs"` entry point from `package.json`.

## [2.11.1] - 2026-09-30

### Added
- Least-privilege release promotion workflow with draft-by-default review and immutable provenance checks.
- Standalone release artifact verifier (`scripts/verify-release-artifact.mjs`) with full test coverage.
- Comprehensive release runbook documenting build versus promotion, artifact provenance, and rollback handling.

### Changed
- Run a single CI execution per commit across pull requests and tags.
- Upgrade GitHub Actions to Node 24 runtimes to eliminate runner deprecation notices.

### Fixed
- Surface asset attach failures as workflow annotations and ensure `GH_REPO` is set for workflows without checkout.
- Untrack legacy release binaries committed before ignore rules.

## [2.11.0] - 2026-09-30

### Added
- Native Node SEA executable hosting an embedded Microsoft Edge WebView2 window.
- Privacy-safe, copyable installation diagnostic reports and failure classification.
- Bounded automatic recovery for transient SteamCMD bootstrap failures.
- Exact managed SteamCMD process path detection and cancellation-aware waiting.
- Dragonwilds credential and LAN bind-address preflight validation.
- Windows Defender Firewall diagnostics and rule creation.
- Provider-specific readiness policies, stability thresholds, and milestone tracking.
- Transactional staging and activation with readiness-gated update validation.
- Checksum-verified automatic rollback and guarded manual rollback.
- Interrupted update state reconciliation on startup.
- Scheduled maintenance integration with safe updates.
- Persistent Tool Health inventory, Authenticode digital signature verification, and staged repair jobs.
- Scheduled action execution audit, calendar schedules, and missed-run policies.
- Moderation expiration tracking, temporary bans, and trusted player session history.
- Steam A2S query protocols and Minecraft status metadata.
- Support bundle generation with strict secret redaction.
- First-run onboarding wizard and server configuration templates.
- Dedicated game server LAN address binding (`192.168.1.210`).

[Unreleased]: https://github.com/A4rk4n/ServerHub/compare/v2.24.0...HEAD
[2.24.0]: https://github.com/A4rk4n/ServerHub/compare/v2.23.0...v2.24.0
[2.23.0]: https://github.com/A4rk4n/ServerHub/compare/v2.22.0...v2.23.0
[2.22.0]: https://github.com/A4rk4n/ServerHub/compare/v2.21.0...v2.22.0
[2.21.0]: https://github.com/A4rk4n/ServerHub/compare/v2.20.0...v2.21.0
[2.20.0]: https://github.com/A4rk4n/ServerHub/compare/v2.19.0...v2.20.0
[2.19.0]: https://github.com/A4rk4n/ServerHub/compare/v2.18.0...v2.19.0
[2.18.0]: https://github.com/A4rk4n/ServerHub/compare/v2.17.0...v2.18.0
[2.17.0]: https://github.com/A4rk4n/ServerHub/compare/v2.16.0...v2.17.0
[2.16.0]: https://github.com/A4rk4n/ServerHub/compare/v2.15.0...v2.16.0
[2.15.0]: https://github.com/A4rk4n/ServerHub/compare/v2.14.0...v2.15.0
[2.14.0]: https://github.com/A4rk4n/ServerHub/compare/v2.13.1...v2.14.0
[2.13.1]: https://github.com/A4rk4n/ServerHub/compare/v2.13.0...v2.13.1
[2.13.0]: https://github.com/A4rk4n/ServerHub/compare/4cd9be85317e0b23023e9cb14c48972e3a137bc6...v2.13.0
[2.12.0]: https://github.com/A4rk4n/ServerHub/compare/v2.11.1...4cd9be85317e0b23023e9cb14c48972e3a137bc6
[2.11.1]: https://github.com/A4rk4n/ServerHub/compare/v2.11.0...v2.11.1
[2.11.0]: https://github.com/A4rk4n/ServerHub/releases/tag/v2.11.0

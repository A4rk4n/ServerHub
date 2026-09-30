# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/A4rk4n/ServerHub/compare/v2.14.0...HEAD
[2.14.0]: https://github.com/A4rk4n/ServerHub/compare/v2.13.1...v2.14.0
[2.13.1]: https://github.com/A4rk4n/ServerHub/compare/v2.13.0...v2.13.1
[2.13.0]: https://github.com/A4rk4n/ServerHub/compare/4cd9be85317e0b23023e9cb14c48972e3a137bc6...v2.13.0
[2.12.0]: https://github.com/A4rk4n/ServerHub/compare/v2.11.1...4cd9be85317e0b23023e9cb14c48972e3a137bc6
[2.11.1]: https://github.com/A4rk4n/ServerHub/compare/v2.11.0...v2.11.1
[2.11.0]: https://github.com/A4rk4n/ServerHub/releases/tag/v2.11.0

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/A4rk4n/ServerHub/compare/v2.11.1...HEAD
[2.11.1]: https://github.com/A4rk4n/ServerHub/compare/v2.11.0...v2.11.1
[2.11.0]: https://github.com/A4rk4n/ServerHub/releases/tag/v2.11.0

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.48.0] - 2026-10-02

### Added

- Disk-space alerts: the panel volume is checked every 5 minutes, and when
  free space drops below the configurable threshold (default 2 GB) the
  webhook fires a `disk-low` notification and an entry lands in the
  activity feed. Repeat alerts respect a cooldown (default 6 hours) and
  re-arm immediately once space recovers; nothing is ever deleted
  automatically. A full disk is the silent killer of game servers —
  backups fail and worlds corrupt mid-save — and the per-server CPU/RAM
  guardrails could not see it coming. Configured from the Tools page with
  a live "Check now" button.
- `GET`/`PUT`/`POST /api/disk-alerts` — the `PUT` rejects malformed JSON
  with `400`; `POST {"action":"check-now"}` forces an immediate check.

### Changed

- Planned "performance alerts" scope folded into this release as disk
  alerts: sustained CPU/RAM alerting already ships as resource guardrails,
  so duplicating it was dropped in favour of the real gap.

## [2.47.0] - 2026-10-02

### Added

- Scheduled announcements: each server can rotate in-game broadcasts
  ("Join our Discord…", "Backups run nightly…") on a configurable interval
  (1–1440 minutes), in sequential or random order (random never repeats the
  previous message), with up to 20 messages of 200 characters each. Reuses
  the restart-warning broadcast plumbing — games with a built-in `say`
  command work out of the box, anything else opts in with a `{message}`
  template. The rotation is managed from the Tasks page, including a
  "Send next now" test button, and anchors one full interval after the
  server starts so players are never greeted by an instant broadcast.
- `GET`/`PUT`/`POST /api/servers/:id/announcements` — the `PUT` rejects
  malformed JSON with `400` so a bad request can never reset the rotation.

## [2.46.3] - 2026-10-01

### Fixed

- Thirteen POST/PATCH/PUT API routes that parsed their JSON body without a
  guard (power, console command, server settings, task create/edit/run,
  file save, backup restore, player moderation/edit, add-on install/toggle,
  template create) now answer `400 Invalid JSON body` instead of crashing
  with a 500 and a stack trace in the panel log.
- The add-on enable/disable toggle requires an explicit boolean `enabled`;
  previously a garbage body could coerce to `false` and silently rename a
  mod to `.disabled`.
- A corrupt `queryMetadata` row can no longer break the diagnostics report
  or crash the Player Connection Center page — both now degrade to showing
  no live provider details.
- Applying a saved template with a corrupt stored config no longer crashes
  the new-server wizard; the template is applied as empty defaults.

## [2.46.2] - 2026-10-01

### Fixed

- Audit CSV export now neutralizes spreadsheet formula injection: fields
  carry user-influenced text (player names, file names, task names, server
  names), so a leading `=`, `+`, `-`, `@`, tab, or CR is prefixed with a
  quote before Excel or Sheets could ever treat it as a formula — proven
  end-to-end against a server literally named `=HYPERLINK("http://evil")`.
- The audit trail's free-text search is debounced (300 ms) so typing no
  longer issues a three-table query per keystroke.

## [2.46.1] - 2026-10-01

### Fixed

- Malformed JSON in a settings `PUT` can no longer silently wipe
  configuration: `/api/status-page` (was: disabled the live status page and
  reset its title), `/api/backup-mirror` (was: saved a disabled mirror over
  a working one), and `/api/servers/:id/restart-warnings` (was: reset the
  warning schedule to defaults) now answer `400 Invalid JSON body` and leave
  the stored config untouched — matching the long-standing behavior of
  `/api/notifications`.
- The status-page module no longer imports `node:crypto`: token generation
  uses Web Crypto and the constant-time comparison is implemented portably,
  so the module shared with the public page's client code is free of
  Node-only imports (previously it only worked because the bundler
  tree-shook the unused import).

## [2.46.0] - 2026-10-01

### Added

- Audit trail: a new page (with nav entry) showing everything that happened
  across the fleet in one newest-first timeline — power actions, file edits
  with their safety-copy references, backups and export bundles, roster and
  moderation changes, task runs, and PIN unlock attempts — merged from the
  activity log, task runs, and moderation actions with per-category icons.
- Filters that compose: category chips
  (power/files/backups/roster/tasks/security/other), server, free-text
  search across summary, detail, and server name, a date range, and
  offset-based *Load older events* paging (`GET /api/audit`).
- CSV export of the filtered timeline — RFC-4180 quoting, CRLF line ends,
  stamped file name, capped at 10,000 rows (`GET /api/audit/export`).
- PIN unlock attempts are now recorded as panel-level security events:
  success, failure with attempts left, throttle trips, and attempts made
  while throttled — best-effort, never able to break an unlock. File-save
  activity now carries the safety-copy name.
- `scripts/test-audit-trail.ts`: 5 tests covering categorization, source
  merging, filters, pagination, and CSV shape (`AUDIT_TRAIL_SUITE_OK`).

## [2.45.0] - 2026-10-01

### Added

- Public status page: a read-only, shareable page for players at
  `/status?token=…` showing which servers are up, player counts, versions
  (with non-vanilla loaders), and uptime — chrome-free, auto-refreshing
  every 30 seconds, with a friendly invalid-link state.
- Token guard instead of the PIN: the page and its endpoint
  (`GET /api/status?token=…`) are exempt from the PIN lock and guarded by a
  32-character secret link token. Disabled pages answer 404 (nothing to
  probe), wrong tokens 401 via constant-time comparison. *New link*
  regenerates the token and revokes the old link instantly.
- The snapshot is whitelist-built — names, games, versions, status, player
  counts, and uptime only; passwords, ports, paths, and addresses cannot
  appear by construction. The token lives in a 0600 `status-page.json`
  outside the database and outside support bundles.
- Tools-page panel: enable toggle, page title, copyable share link, open
  in new tab, and one-click link rotation
  (`GET`/`PUT`/`POST /api/status-page`, PIN-protected).
- `scripts/test-status-page.ts`: 5 tests covering config/token handling,
  access decisions, snapshot whitelisting, label collapsing, and the exact
  PIN-exemption surface (`STATUS_PAGE_SUITE_OK`).

## [2.44.0] - 2026-10-01

### Added

- Disk usage explorer on every server's Files page: a stacked storage
  breakdown (world / mods & plugins / logs / everything else / backups),
  the ten biggest files with category badges, 24-hour and 7-day growth
  computed from daily snapshots (kept 90 days in `disk-usage.json`), and a
  Rescan button (`GET /api/servers/:id/disk-usage`).
- Cleanup hints that only fire on real problems: oversized logs,
  crash-report pileups, many backups with no retention policy, and single
  giant files — deterministic and capped at four.
- The directory walk is symlink-free and entry-budgeted (50,000); truncated
  scans are labeled as lower bounds. Backup sizes are measured from the
  archives on disk with the database size as fallback.
- `scripts/test-disk-usage.ts`: 5 tests covering classification, report
  ranking, snapshot history, growth, and hints (`DISK_USAGE_SUITE_OK`).

## [2.43.0] - 2026-10-01

### Added

- Backup mirror target: keep a checksum-verified second copy of every
  completed backup on another disk, NAS share, or synced folder. Copies are
  written via a temp file and re-hashed — a copy only counts when its SHA-256
  matches the primary archive. Pruned backups take their mirror copy with
  them, and *Sync now* reconciles the whole mirror (copies missing or failed,
  removes stale copies, self-heals vanished files).
- Mirror health everywhere it matters: coverage line in the activity digest
  (`🪞 Backup mirror: 5/6 mirrored · 1 pending`), a new `mirror-failed`
  webhook notification in the backup group, and health chips with the last
  error on the new Tools-page panel.
- `GET`/`PUT`/`POST /api/backup-mirror`: status + health, validated settings
  (the mirror can never point inside the Server Hub data directory), and
  on-demand synchronization.
- `scripts/test-backup-mirror.ts`: 5 tests covering config/directory safety,
  state normalization, sync planning, traversal-proof layout naming, and
  health/digest formatting (`BACKUP_MIRROR_SUITE_OK`).

## [2.42.0] - 2026-10-01

### Added

- Full-history console search: the console page gains a collapsible search
  panel that queries every stored log line across sessions — plain text or
  regular expression (case-insensitive), level and source filters, and an
  optional date range — with cursor-based pagination to continue into older
  lines (`GET /api/servers/:id/console/search`).
- Console log export: download any filtered span of the console history as a
  plain-text `.log` file named after the server, capped at 20,000 lines with
  an explicit truncation note (`GET /api/servers/:id/console/export`).
- `scripts/test-console-search.ts`: 5 tests covering parameter normalization,
  text/regex/level/source matching, budgeted scan pagination, log-line
  formatting, and export file naming (`CONSOLE_SEARCH_SUITE_OK`).

## [2.41.0] - 2026-10-01

### Added
- Restart countdown warnings: scheduled stops and restarts now warn players in-game before acting — "Server will shut down in 10 minutes… 5 minutes… 1 minute… 30 seconds" — then perform the action when the countdown reaches zero. Warning marks are configurable per server on the Tasks page (the longest mark sets the countdown length), Minecraft, Terraria, and Rust broadcast out of the box, and any other game can opt in with a custom broadcast template. A running countdown is shown in the panel and can be cancelled with one click; manual stops always take effect immediately.

## [2.40.0] - 2026-10-01

### Added
- Server export bundles: pack any server into a portable `.tar.gz` from the Backups page — all files plus a manifest recording the game, version, and launch settings, protected by a verification checksum. Passwords are never included. Extract the bundle anywhere and the Import flow recognizes it: the manifest is read back automatically so the game and settings are prefilled, making export/import a true round trip between machines.

## [2.39.0] - 2026-10-01

### Added
- Activity digest: an optional daily or weekly summary of your whole fleet, delivered to your notification webhook at a local hour you choose (weekly digests go out on Mondays). Each digest covers uptime percentage, unique players and peak concurrency, total playtime, backup successes and failures, crashes, guardrail trips, and pending game updates — per server and as fleet totals. Configure it in Settings → Notifications, where a "Send digest now" button delivers one immediately. If the panel was off at send time, the digest catches up on the next sweep.

## [2.38.0] - 2026-10-01

### Added
- Whitelist & operators manager for Minecraft Java servers on the Players page: toggle whitelist enforcement, add or remove whitelisted players, and promote or demote operators — with name suggestions drawn from players the panel has already seen. While the server is running, changes go through the console so the game resolves real account UUIDs itself; while it is offline, ServerHub edits `whitelist.json`, `ops.json`, and `server.properties` directly (using the same vanilla offline-UUID derivation the game uses), complete with the config editor's automatic safety copies.

## [2.37.0] - 2026-10-01

### Added
- Config editor upgrades in the file manager: config files (`.properties`, `.yml`/`.yaml`, `.toml`, `.json`) are now validated as you type, with a live badge showing either "valid" or the exact line and problem. Saving a config file opens a review step first — a colored diff of what changed with added/removed counts — and every save of a changed file automatically keeps a timestamped safety copy right next to it (the newest five are retained), so you can always open the previous version and copy it back. Invalid content is blocked with a clear explanation unless you explicitly choose "Save anyway".

## [2.36.0] - 2026-10-01

### Added
- Crash analyzer: when a server crashes, Server Hub now reads the end of the console output and tells you why in plain language — EULA not accepted, out of memory, port already taken, Java version too old, corrupted world data, a failing mod or plugin, a missing launch file, or a full disk — each with a concrete suggested fix (the out-of-memory fix even cites your current memory limit). The diagnosis appears instantly in the console, lands in Diagnostics as an incident with the fix attached, and is included in the crash webhook notification. Crashes that match no known pattern still get a useful summary with the exit code instead of silence.

## [2.35.0] - 2026-10-01

### Added
- Power schedules: "Start server" and "Stop server" are now schedulable task types, and a one-click "Power window" button on the Tasks tab creates a matched daily pair — for example up at 15:00, down at 23:00 — so the server only runs while people actually play and your PC stays quiet the rest of the day. Overnight windows (stop after midnight) work too. A scheduled start that finds the server already running, or a stop that finds it already offline or still shutting down gracefully, records a skipped run with the reason instead of failing — the task history always tells you exactly what happened and why.

## [2.34.0] - 2026-10-01

### Added
- Panel PIN lock (Tool Health page → Panel PIN lock): optionally require a 4–12 digit PIN to open Server Hub, so housemates or siblings at the same PC cannot wander into your server controls. While locked, every page redirects to a dedicated lock screen and every API call is refused; the launcher's health probe keeps working so startup is unaffected. Five wrong PINs pause attempts for 30 seconds, unlocks last 12 hours per browser, a "Lock now" button locks instantly, and changing or removing the PIN signs out every browser at once. The PIN is stored only on your PC as a salted scrypt hash; if you ever forget it, delete pin-lock.json from the Server Hub data folder while the panel is closed. Off by default — nothing changes until you set a PIN.

## [2.33.0] - 2026-10-01

### Added
- Backup browser: every completed backup now has a Browse button that lists the files inside the archive without unpacking it. Search the list, preview configuration files as text (server.properties, YAML, JSON, logs and more), download any single file, or restore just one file back into the server directory — perfect for recovering a config you broke without rolling back the whole world. Single-file restore sits behind the same safety gates as a full restore: the server must be stopped and the archive checksum is verified first, and archive paths are strictly validated so a crafted backup can never write outside the server directory.

## [2.32.0] - 2026-10-01

### Added
- Command macros: save named sequences of console commands — like "announce, wait 30 seconds, save the world, restart" — and fire them with one click from the Console tab or on a schedule from the Tasks tab. Each step can pause up to two minutes before the next; a failing step stops the sequence immediately so a stopped server never receives the rest. Running a macro always shows the exact commands first, and scheduling one requires confirming those exact commands — the same safety contract as scheduled commands and broadcasts. Macros are per server (up to 20, with up to 12 steps each) and can be edited or deleted at any time; a scheduled macro whose macro was deleted records a failed run instead of silently doing nothing.

## [2.31.0] - 2026-10-01

### Added
- Player analytics on the Players tab: a new panel shows unique players, total playtime, peak concurrent players, and average session length over a selectable 7/14/30-day window, plus a daily playtime chart, a busy-hours histogram (which hours of the day your server is actually played), and a top-players leaderboard with live online markers. Powered by the session journal, which now also records joins and leaves observed through the server console (Minecraft Java and Bedrock, Palworld) — previously only Steam query-based games tracked sessions. Open sessions count toward playtime in real time, and all sessions close when the server stops or the panel restarts, so downtime is never counted as playtime.

## [2.30.0] - 2026-10-01

### Added
- Per-server resource guardrails (Diagnostics → Resource guardrails): set a CPU and/or RAM ceiling plus a sustain window of 1–8 minutes, and get alerted only when usage stays above the threshold for the entire window — a short spike from a world save or chunk generation never triggers. A breach writes a console warning, opens a Diagnostics incident, records activity, fires webhook notifications (crash group), and shows an amber "guardrail" chip on the server card; an optional, off-by-default action restarts the server automatically. Alerts fire once per episode with a 15-minute cooldown, and reset when usage recovers. Guardrails are off by default and require a fully populated sample window, so freshly started servers are never flagged on incomplete data.

## [2.29.0] - 2026-10-01

### Added
- Scheduled game updates that check first: the Tasks page gains a "Game update" task type that looks for a newer build before doing anything — and leaves the server completely untouched (no stop, no backup, no restart) when nothing new is published, recording the reason in the task history. Minecraft servers update when a newer stable release appears in the official catalog; SteamCMD titles use the conservative installed-vs-published build comparison (an unreachable metadata mirror never causes churn); rolling-release providers refresh on schedule; custom servers are never auto-updated. When an update does run, it uses the full validated lifecycle: players are warned, the server stops gracefully, a safety backup is taken, and the first start must pass the readiness probe — otherwise the previous version is restored automatically.

## [2.28.2] - 2026-09-30

### Fixed
- Modern Minecraft servers (26.1 and newer, including Fabric) crashed on startup with "UnsupportedClassVersionError … class file version 69.0 … only recognizes … up to 52.0": the Java selector predated Mojang's 2026 switch to calendar versioning, parsed "26.x" as an ancient 1.x release, and launched the server under Java 8. Calendar versions now correctly get Java 25, weekly snapshots are mapped by development era, legacy 1.x boundaries are unchanged (1.16 → Java 8, 1.18–1.20.4 → Java 17, 1.20.5–1.21.x → Java 21), and any unrecognized version now defaults to the newest runtime instead of the oldest — a modern JVM runs older servers, while the reverse always fails.

## [2.28.1] - 2026-09-30

### Fixed
- Minecraft Fabric installation crashed at 15% with "Cannot read properties of undefined (reading 'stable')": the Fabric metadata service lists loader versions and installer versions on two separate endpoints, but the installer version was read from the loader list, where it does not exist. The installer is now resolved from its own endpoint, the newest stable loader/installer pair is preferred (with sensible fallbacks for pre-release-only game versions), and malformed metadata produces a clear error message instead of a crash.

## [2.28.0] - 2026-09-30

### Added
- Import/adopt an existing server directory: the Servers view gains an "Import existing" flow that points Server Hub at a folder you already have on disk. Inspection fingerprints the folder against the executables of all ten supported games (nested Unreal-style layouts included) and reports what it found; adoption then registers the server as-is — nothing is downloaded, moved, or reinstalled, the folder stays unmanaged, and deleting the server later leaves it untouched. Game-specific rules still apply on adoption (Minecraft EULA, Valheim password, Dragonwilds owner and admin password), folders without a recognized game can be adopted as custom servers with a launch command, and folders inside Server Hub's own data directory or already claimed by another server are refused.

## [2.27.0] - 2026-09-30

### Added
- Metrics history that outlives the 8-minute live window: while a server runs, its 2-second samples are rolled into one-minute buckets (average CPU/RAM, peak players) and persisted per server, so charts survive both game-server restarts and Hub restarts. The console's vitals panel gains a Live / 24 h toggle — the 24-hour view shows CPU, RAM, and player-count charts side by side. History is capped at 48 hours with automatic compaction, collection is strictly best-effort (it can never slow down or destabilize a running server), and corrupt history files degrade gracefully instead of breaking charts.

## [2.26.0] - 2026-09-30

### Added
- Game-server update alerts for SteamCMD titles: each server page now compares the installed build (from SteamCMD's local app manifest) against the latest public build and shows an amber "game update available" badge — with installed → latest build ids in the tooltip — linking to the Settings tab where updates run. The comparison is deliberately conservative: it alerts only when the reported latest build is strictly newer, so a lagging metadata mirror can never raise a false alarm, and any missing information reads as "unknown" rather than a warning. Lookups are cached per Steam app (six hours; failures retried after fifteen minutes) and bounded, keeping the check invisible in day-to-day use.

## [2.25.0] - 2026-09-30

### Added
- Bulk fleet power actions: the Servers view gains Start / Restart / Stop buttons that act on the currently filtered list, with live eligible counts and a two-click confirmation. Starts are staggered 2.5 seconds apart so launching a whole fleet cannot spike CPU or disk; stops and restarts run concurrently and report per-server outcomes (including skip reasons). Eligibility is conservative and shared between the UI and the API: bulk start only touches stopped, crashed, or failed servers; bulk restart only touches servers that are actually online; servers that are installing, updating, or already stopping are never affected.

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

[Unreleased]: https://github.com/A4rk4n/ServerHub/compare/v2.48.0...HEAD
[2.48.0]: https://github.com/A4rk4n/ServerHub/compare/v2.47.0...v2.48.0
[2.47.0]: https://github.com/A4rk4n/ServerHub/compare/v2.46.3...v2.47.0
[2.46.3]: https://github.com/A4rk4n/ServerHub/compare/v2.46.2...v2.46.3
[2.46.2]: https://github.com/A4rk4n/ServerHub/compare/v2.46.1...v2.46.2
[2.46.1]: https://github.com/A4rk4n/ServerHub/compare/v2.46.0...v2.46.1
[2.46.0]: https://github.com/A4rk4n/ServerHub/compare/v2.45.0...v2.46.0
[2.45.0]: https://github.com/A4rk4n/ServerHub/compare/v2.44.0...v2.45.0
[2.44.0]: https://github.com/A4rk4n/ServerHub/compare/v2.43.0...v2.44.0
[2.43.0]: https://github.com/A4rk4n/ServerHub/compare/v2.42.0...v2.43.0
[2.42.0]: https://github.com/A4rk4n/ServerHub/compare/v2.41.0...v2.42.0
[2.41.0]: https://github.com/A4rk4n/ServerHub/compare/v2.40.0...v2.41.0
[2.40.0]: https://github.com/A4rk4n/ServerHub/compare/v2.39.0...v2.40.0
[2.39.0]: https://github.com/A4rk4n/ServerHub/compare/v2.38.0...v2.39.0
[2.38.0]: https://github.com/A4rk4n/ServerHub/compare/v2.37.0...v2.38.0
[2.37.0]: https://github.com/A4rk4n/ServerHub/compare/v2.36.0...v2.37.0
[2.36.0]: https://github.com/A4rk4n/ServerHub/compare/v2.35.0...v2.36.0
[2.35.0]: https://github.com/A4rk4n/ServerHub/compare/v2.34.0...v2.35.0
[2.34.0]: https://github.com/A4rk4n/ServerHub/compare/v2.33.0...v2.34.0
[2.33.0]: https://github.com/A4rk4n/ServerHub/compare/v2.32.0...v2.33.0
[2.32.0]: https://github.com/A4rk4n/ServerHub/compare/v2.31.0...v2.32.0
[2.31.0]: https://github.com/A4rk4n/ServerHub/compare/v2.30.0...v2.31.0
[2.30.0]: https://github.com/A4rk4n/ServerHub/compare/v2.29.0...v2.30.0
[2.29.0]: https://github.com/A4rk4n/ServerHub/compare/v2.28.2...v2.29.0
[2.28.2]: https://github.com/A4rk4n/ServerHub/compare/v2.28.1...v2.28.2
[2.28.1]: https://github.com/A4rk4n/ServerHub/compare/v2.28.0...v2.28.1
[2.28.0]: https://github.com/A4rk4n/ServerHub/compare/v2.27.0...v2.28.0
[2.27.0]: https://github.com/A4rk4n/ServerHub/compare/v2.26.0...v2.27.0
[2.26.0]: https://github.com/A4rk4n/ServerHub/compare/v2.25.0...v2.26.0
[2.25.0]: https://github.com/A4rk4n/ServerHub/compare/v2.24.0...v2.25.0
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

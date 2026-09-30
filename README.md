# Server Hub

Server Hub is a local desktop application for installing and operating **real dedicated game-server processes**. It starts the actual server executable, streams its stdout/stderr, writes commands to stdin, reads the real server directory, creates real compressed backups, and records runtime state in an embedded SQLite database.

There are no sample servers, simulated players, generated console lines, fake metrics, cloud nodes, or external databases. A fresh install opens with an empty fleet.

## Windows portable application

Server Hub ships as a standalone Windows x64 portable package (`ServerHub-*-Windows-x64-Portable.zip`):

- **Native desktop window:** `ServerHub.exe` is a Node Single Executable Application (SEA) hosting an embedded Microsoft Edge WebView2 window. It starts without a Command Prompt and does not open an external browser or Edge/Chrome app-mode window.
- **Graceful lifecycle:** Closing the native window gracefully stops the local management service and all running game-server child processes.
- **Self-contained runtimes:** Server Hub embeds the Node runtime and local application server. Managed dependencies such as Eclipse Temurin Java runtimes (Java 8, 17, 21) and SteamCMD are acquired automatically into the app-data folder on demand without requiring administrator privileges.
- **Persistent application data:** Configuration, SQLite database, server directories, tools, and backups are stored under `%APPDATA%\ServerHub` and survive application updates.

The executable is not code-signed with a commercial certificate; Windows SmartScreen may present a first-run prompt. Release archives include SHA-256 checksums (`SHA256SUMS`), `release-manifest.json`, and a CycloneDX SBOM for independent verification.

## Real installation support

| Server type | Installation | Launch/runtime |
| --- | --- | --- |
| Minecraft Java | Official Mojang version manifest; SHA-1 verified | Private Eclipse Temurin Java 8, 17, or 21 selected by game version |
| Minecraft Fabric | Fabric Meta API | Fabric server launcher; live Modrinth catalog with SHA-512-verified mod files and required dependencies |
| Minecraft Bedrock | Official Minecraft download page | Official Windows or Linux Bedrock executable |
| Valheim | SteamCMD app `896660` | Official dedicated-server executable |
| ARK: Survival Evolved | SteamCMD app `376030` | Official `ShooterGameServer` executable |
| Terraria | SteamCMD app `105600` | Official Terraria server executable and generated config |
| Rust | SteamCMD app `258550` | Official `RustDedicated` executable |
| Satisfactory | SteamCMD app `1690800` | Official `FactoryServer` launcher with `-multihome` LAN binding |
| Palworld | SteamCMD app `2394010` | Official `PalServer` launcher; managed `PalWorldSettings.ini` (no bind-address flag — listens on all interfaces) |
| Dragonwilds / Hytale | SteamCMD / manual registration | Managed or user-supplied executable with preflight checks and LAN binding |
| Custom | Manual registration | Any executable, `.bat`, `.cmd`, or shell script in a managed or existing folder |

Publisher availability and anonymous SteamCMD access can change. If a publisher requires an account or does not publish a compatible dedicated-server binary for your OS, Server Hub reports the real installer error rather than pretending installation succeeded.

## Features

- **Recoverable installation jobs:** Installation state, phases, progress, byte counts, attempts, and events are persisted in SQLite. Interrupted jobs automatically return to the queue when Server Hub restarts.
- **Safe installation activation:** Managed downloads are prepared and validated in a sibling staging directory, then atomically activated so a failed installer cannot replace the current server directory.
- **Installer preflight and controls:** Cancel/retry controls, resumable downloads, disk-space checks, and TCP/UDP port-conflict detection before installation and launch.
- **Real lifecycle management:** Start, graceful stop, restart, force-kill, crash detection, PID reporting, and process-tree cleanup.
- **Bounded crash recovery:** Optional automatic restart with exponential backoff (2, 4, 8... seconds, capped at 30s), configurable attempt/window limits, and crash-loop protection.
- **Live console:** Persisted stdout/stderr, severity detection, command history, and direct stdin commands.
- **Real process metrics:** Resident memory and CPU usage sampled directly from the operating system.
- **Player observation & queries:** Minecraft and Bedrock join/leave events parsed from live logs; Steam A2S query protocols for player counts, server metadata, and challenge queries.
- **Filesystem manager:** Browses the real installation tree and atomically edits safe text/config formats. Path traversal and symlink escapes outside the root are strictly rejected.
- **Checksum-verified backups:** Creates real `.tar.gz` archives, records SHA-256 digests, and validates archives before restore with preview verification. Configurable retention (count and age limits) prunes old completed backups automatically and never removes the active pre-update safety backup.
- **Credential vault:** Protects server passwords and sensitive tokens using Windows DPAPI (CurrentUser scope) with recoverable migration.
- **Windows Firewall & Network Center:** Inspects and creates required Windows Defender Firewall rules; displays LAN bind addresses and public NAT endpoints.
- **Tool Health & repair pipeline:** Monitors managed tool inventory (SteamCMD, Java runtimes), verifies Authenticode digital signatures, and stages non-destructive repairs.
- **Task scheduler:** Runs backups, restarts, broadcasts, and custom commands with calendar schedules, missed-run policies, and execution audit logging.
- **Player moderation:** Whitelist, op, kick, and ban management with restart-safe temporary ban expiration and audit history.

## Networking and security

- **Local-only management:** The desktop management API binds strictly to `127.0.0.1:4321` and requires a per-launch random session token. It must never be exposed directly to the internet.
- **LAN server binding:** Game processes bind to the server machine's locally assigned LAN address (e.g. `192.168.1.210`). Public addresses (e.g. `185.83.148.20`) are descriptive for player connection instructions and router port-forwarding.
- **Bounded data isolation:** Support bundle exports redact passwords, tokens, and player IDs, and strictly exclude database files, worlds, credentials, and private configs.
- **EULA enforcement:** Minecraft installation requires explicit acceptance of the Mojang EULA during the onboarding or setup flow.

## Build from source

### Requirements

- Node.js **24.21.0** (pinned in `.node-version`; uses built-in `node:sqlite`)
- npm **10** or newer
- Internet access for npm dependency installation and game server downloads

### Verification and testing

```bash
# Install dependencies
npm ci

# Typecheck and linting
npm run typecheck
npm run lint

# Build standalone application server
npm run build:server

# Run test suite
npm test

# Verify production dependency audit
npm audit --omit=dev
```

`npm test` runs every suite on Node 24's built-in test runner (`node --test`): test files execute in parallel with per-test timing and a pass/fail summary. Use `npm run test:unit` for everything except the installation-job lifecycle integration (which runs natively on both Linux and Windows), and `npm run test:<suite>` (for example `npm run test:security`) to run a single suite in isolation.

### Building the Windows portable package

```bash
# Build the standalone Windows x64 portable executable and release ZIP
npm run dist:win:portable
```

The resulting package is written to `release/ServerHub-<version>-Windows-x64-Portable.zip` along with `SHA256SUMS`, `release-manifest.json`, and the CycloneDX SBOM.

### Running in local development mode

```bash
# Start Next.js development server
npm run dev

# Or run using local start scripts
run.bat       # Windows
./run.sh      # macOS / Linux
```

## Documentation

- [Architecture Overview](docs/ARCHITECTURE.md)
- [Provider Integration Guide](docs/PROVIDER-INTEGRATION.md)
- [Releasing Guide](docs/RELEASING.md) (canonical) and the condensed [Release Runbook](RELEASE.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Security Policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [Historical Records](docs/history/)

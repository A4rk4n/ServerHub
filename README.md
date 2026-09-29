# Server Hub

Server Hub is a local desktop application for installing and operating **real dedicated game-server processes**. It starts the actual server executable, streams its stdout/stderr, writes commands to stdin, reads the real server directory, creates real compressed backups, and records runtime state in an embedded SQLite database.

There are no sample servers, simulated players, generated console lines, fake metrics, cloud nodes, or external databases. A fresh install opens with an empty fleet.

## Download / run on Windows

Use one of the Windows artifacts from a release or from `release/` when it is present:

- **`ServerHub-1.0.2-Windows-x64-Portable.zip`** — extract the complete `ServerHub` folder into a new location, then double-click `ServerHub.exe`. It starts without a Command Prompt and opens Server Hub in a dedicated desktop-style Edge/Chrome window.
- **`ServerHub-Setup-1.0.2-x64.exe`** — Electron/NSIS installer target with desktop and Start Menu shortcuts (produced by `npm run dist:win` when Electron's packaging CDN is reachable).

The executables are not code-signed. Windows SmartScreen can therefore display an “unknown publisher” warning. Review the source and build it yourself if preferred.

Server Hub itself needs no separately installed Node.js, database, Java, or SteamCMD. Both Windows packages contain the Node runtime and application server. When required, it downloads a private Java runtime or SteamCMD into the app-data folder without administrator rights.

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
| Dragonwilds / Hytale | Manual registration | User-supplied executable/script and arguments; no invented download URL |
| Custom | Manual registration | Any executable, `.bat`, `.cmd`, or shell script in a managed or existing folder |

Publisher availability and anonymous SteamCMD access can change. If a publisher requires an account or does not publish a compatible dedicated-server binary for your OS, Server Hub reports the real installer error rather than pretending installation succeeded.

## Features

- **Recoverable installation jobs:** installation state, phases, progress, byte counts, attempts and events are persisted in SQLite. Interrupted jobs automatically return to the queue after Server Hub restarts.
- **Safe installation activation:** managed downloads are prepared and validated in a sibling staging directory, then atomically activated so a failed installer cannot replace the current server directory.
- **Installer controls and preflight:** cancel/retry controls, resumable HTTP downloads, disk-space checks and real TCP/UDP port-conflict checks are shown directly on the server page.
- **Real lifecycle management:** start, graceful stop, restart, force-kill, crash detection, PID reporting, and process-tree cleanup.
- **Bounded crash recovery:** optional automatic restart with exponential backoff, a configurable attempt/window limit, crash-loop protection, and a cancel-restart control.
- **Launch preflight:** the configured TCP/UDP game port is checked again immediately before every process launch, not only during installation.
- **Live console:** persisted stdout/stderr, severity detection, command history, and direct stdin commands.
- **Real process metrics:** resident memory and CPU usage from the operating system.
- **Player observation:** Minecraft/Bedrock join and leave messages are parsed from actual console output. Player actions issue actual server commands.
- **Filesystem manager:** browses the real installation tree and atomically edits safe text/config formats. Path traversal and symlink escapes are rejected.
- **Backups:** creates real `.tar.gz` archives, records a SHA-256 checksum, downloads the archive, and performs checksum-verified rollback with failure recovery.
- **Scheduler:** runs backups, restarts, broadcasts, and raw commands in the local runtime even when the page is not open.
- **Configuration:** writes actual Minecraft, Bedrock, and Terraria configuration files before launch.
- **Live Fabric mods:** searches Modrinth, selects a version matching the server, installs required dependencies, verifies SHA-512, and physically enables/disables/uninstalls files.
- **Local SQLite:** configuration and logs remain on the PC and survive application updates.

## Data locations

Desktop builds use Electron's per-user app-data directory (use **Server → Open data folder** in the desktop menu to open the exact location). It is normally under `%APPDATA%` on Windows, `~/Library/Application Support` on macOS, or `~/.config` on Linux.

Inside it:

```text
serverhub.db       settings, status, logs, schedules, backup metadata
servers/<id>/      managed game-server installations and worlds
backups/<id>/      real compressed backup archives
tools/             private Java runtimes and SteamCMD
downloads/         temporary downloads (removed after extraction)
```

A custom server can point at an existing absolute working directory. Removing that Server Hub entry **does not delete the external directory**. Managed directories are deleted only after the explicit name-confirmation flow.

## Networking and safety

- The management UI binds only to `127.0.0.1`; it has no remote authentication and must not be exposed to the internet.
- Game processes bind according to their own configuration. To accept LAN/internet players, allow the game port in Windows Firewall/router settings as appropriate.
- The file API is rooted to each server directory, limits editable file size, rejects traversal, and does not follow symlinks outside the root.
- Downloads use HTTPS. Mojang, Modrinth, and backup archives are checksum verified where the upstream provides a digest.
- Passwords are stored in the local SQLite database and are redacted from API/UI responses. Protect your OS account and app-data folder.
- Minecraft installation requires explicit acceptance of the Minecraft EULA in the setup wizard.

## Build from source

### Requirements

- Node.js **22.5 or newer** (the app uses built-in `node:sqlite`)
- npm
- Internet access for npm and Electron packaging downloads

```bash
npm ci
npm run typecheck
npm run lint
npm run build:server
npm run test:installation-jobs
```

Run the local web build:

```bash
./run.sh                 # macOS / Linux
run.bat                  # Windows
```

Or launch the Electron development shell:

```bash
npm run desktop:dev
```

Build for the current operating system:

```bash
npm run dist
```

Build the Windows x64 installer from a supported host, or build the browser-based portable executable on any host running the matching Node release:

```bash
npm run dist:win             # Electron + NSIS installer
npm run dist:win:portable    # release/ServerHub-*-Portable.zip
```

Installer artifacts are written to `dist/`; the portable ZIP and checksum are written to `release/`. Platform packaging targets are configured in `electron-builder.yml`:

- Windows: NSIS installer `.exe`
- macOS: x64 and arm64 `.dmg`
- Linux: x64 AppImage

Cross-building Windows from Linux is supported by electron-builder for the unsigned NSIS target. Build macOS artifacts on macOS.

## Source layout

```text
electron/                 secure Electron shell and local server supervisor
src/app/api/              local REST API
src/lib/runtime.ts        installers, processes, console parsing, metrics, backups, scheduler
src/lib/filesys.ts        rooted real-filesystem browser/editor
src/db/                   SQLite schema and additive migrations
scripts/prepare-standalone.mjs
                          assembles Next.js standalone output
build-resources/          desktop icons
```

## Environment variables (source/web mode)

| Variable | Default | Purpose |
| --- | --- | --- |
| `SERVERHUB_PORT` | `4321` | Local management HTTP port |
| `SERVERHUB_APPDATA` | `./data` in launch scripts | Runtime data root |
| `SERVERHUB_DB` | `./data/serverhub.db` in launch scripts | SQLite database path |
| `PORT` | derived from `SERVERHUB_PORT` | Next.js server port |
| `HOSTNAME` | `127.0.0.1` | Management bind address |

## Validation performed in this repository

```bash
npm audit             # 0 known vulnerabilities
npm run typecheck     # strict TypeScript
npm run lint                    # Next.js/React ESLint
npm run build:server            # production standalone build
npm run test:installation-jobs  # persistence, preflight, retry, cancel and restart recovery
```

An end-to-end runtime test also registers a custom shell process, starts it, sends stdin, captures real stdout, browses its files, creates a checksum-backed archive, stops it gracefully, restores the archive, and removes the Server Hub entry while confirming the external folder remains intact.

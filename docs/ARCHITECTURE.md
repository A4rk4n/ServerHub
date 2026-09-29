# Server Hub architecture

Server Hub is a Windows-first local desktop application. `ServerHub.exe` owns the native WebView2 window and embeds a Node launcher. The bundled Next.js service binds only to loopback and requires a random per-launch session token.

## Data and processes

Persistent data lives under `%APPDATA%\ServerHub`. Managed game processes are launched and monitored by `src/lib/runtime.ts`. SQLite stores configuration and durable jobs; secrets use Windows DPAPI with CurrentUser scope. Game services bind to each server's configured LAN address, while the management service remains local-only.

## Provider lifecycle

Providers download into recoverable staging directories, validate artifacts, write managed configuration, and atomically activate installations. Startup uses provider-aware readiness where supported. Watchdog restarts are bounded and use exponential backoff.

## Security boundaries

Never expose the management service publicly. API requests must originate from loopback and present the desktop session. Downloads use bounded extraction and provider checks. Diagnostic/support exports redact secrets and exclude worlds, databases, credentials, and private configuration.

## Migrations and releases

Schema changes are additive and recorded in `schema_migrations`. Credential migration creates a checkpointed recovery backup. Release builds require a clean Git tree and embed the source commit, checksums, package integrity metadata, and CycloneDX SBOM.

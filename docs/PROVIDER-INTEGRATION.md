# Provider integration guide

A provider definition belongs in `src/lib/games.ts`; lifecycle behavior belongs in `src/lib/runtime.ts`. Keep catalog metadata declarative and provider execution explicit.

## Required behavior

- Declare ports and protocols accurately; never invent query support.
- Download through the bounded installation-job pipeline.
- Validate archive paths, links, file count, and expanded size before activation.
- Write configuration without logging credentials.
- Launch children without a visible console window.
- Stop gracefully before forcing termination.
- Implement readiness from an authenticated protocol or documented process behavior.
- Redact provider-specific IDs and secrets from diagnostics.

## Testing

Exercise interrupted download recovery, cancellation, retries, invalid archives, port conflicts, startup timeout, graceful stop, crash throttling, update rollback, and deletion. Add representative redacted logs only when their origin and semantics are known.

## Networking

The desktop management service is always loopback-only. Game services bind to the configured LAN address. A public address is descriptive: router/NAT forwarding remains an administrator responsibility.

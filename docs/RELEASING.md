# Release checklist

1. Use the assigned release branch and require a clean tracked tree.
2. Update package version and release notes.
3. Run Node 24 typecheck, lint, security, migration, installation-job, watchdog, production build, package-integrity, and production-audit checks.
4. Build the native Windows GUI launcher; confirm it embeds WebView2 and does not open a browser or console.
5. Extract the portable package into a clean directory and rerun integrity checks there.
6. Confirm management binds only to loopback and child processes remain hidden.
7. Generate build information, SHA-256 manifest, release manifest, and CycloneDX SBOM.
8. Verify every listed checksum independently.
9. Smoke-test install, start, readiness, stop, backup, restore preview, diagnostics, and graceful window close on Windows.
10. Upload without replacing historical artifacts. Make only the intended new file public.
11. Record artifact size, SHA-256, SBOM checksum, source commit, and download URL.

Never package databases, credentials, worlds, logs, `node_modules`, source build caches, or private configuration.

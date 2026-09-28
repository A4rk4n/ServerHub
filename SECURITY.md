# Security policy

Server Hub's management service is a local desktop API. It binds to loopback, validates Host and Origin, limits request sizes, and packaged desktop sessions use a random per-launch HttpOnly session cookie. Do not expose its port through a reverse proxy or firewall rule.

Report vulnerabilities privately through GitHub Security Advisories. Do not include credentials, databases, worlds, or launcher logs in public reports.

Release artifacts include SHA256SUMS, provenance metadata, and a CycloneDX SBOM. Verify checksums before execution.

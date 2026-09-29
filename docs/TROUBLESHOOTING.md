# Troubleshooting

## Server does not start

1. Open **Diagnostics** and review Health, Setup checklist, and Incidents.
2. Confirm the Bind IP belongs to this PC.
3. Confirm the port is not used by another process.
4. Use **Repair and retry** for missing or damaged installation tools.
5. Download a redacted Support ZIP when reporting a problem.

## Players cannot connect

Open **Connect** and distinguish the LAN and Internet endpoints. Create/repair Windows Defender Firewall rules from Diagnostics, then forward every listed game/query port on the router to the displayed LAN target. Firewall rules do not configure the router.

## Installation appears stuck

Server Hub warns after two minutes without progress. Cancel the job, then use **Repair and retry**. SteamCMD is reacquired when its managed files are cleared.

## Backup restore

Stop the server first. Open Backups, verify the archive, then review the restore preview. Restore remains disabled when checksum verification fails.

## Credentials cannot be decrypted

DPAPI credentials belong to the Windows account that protected them. Run Server Hub as the original user or use **Reset stored credentials** in Settings and enter replacement values. Do not delete the pre-DPAPI recovery backup until all servers have been tested.

## Safe information to share

Use the Support ZIP. Never share `%APPDATA%\ServerHub`, the SQLite database, worlds, raw configuration files, passwords, Player IDs, or tokens.

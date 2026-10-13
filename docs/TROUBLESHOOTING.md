# Troubleshooting

## Server does not start

1. Open **Diagnostics** and review Health, Setup checklist, and Incidents.
2. Confirm the Bind IP belongs to this PC.
3. Confirm the port is not used by another process.
4. Use **Repair and retry** for missing or damaged installation tools.
5. Download a redacted Support ZIP when reporting a problem.

## Players cannot connect

Open **Connect** and distinguish the LAN and Internet endpoints. Create/repair Windows Defender Firewall rules from Diagnostics, then forward every listed game/query port on the router to the displayed LAN target. Firewall rules do not configure the router.

### RuneScape: Dragonwilds — LAN joins work but friends cannot connect

Dragonwilds has three quirks the generic steps miss (the Connection doctor repeats them for Dragonwilds servers):

1. **One UDP port, same number on both sides.** Forward UDP 7777 → 7777 (or whatever the server's port is — identical external and internal numbers). An asymmetric forward kicks joining players back to the title screen with nothing in the server log. There is no TCP port and no separate query port to open.
2. **Join with the in-game "Custom IP address" option.** Select the world in the server browser, tick *Custom IP address*, then enter the address directly: players on the server's own network enter the **LAN** address (e.g. `192.168.1.210:7777`); players on the internet enter the **public** address. Needing the LAN address at home is normal — home routers do not loop a public IP back inside (no NAT hairpin), so this does not mean the server is broken for outside players.
3. **The Windows Firewall rule must allow inbound UDP** for the server executable/port — create it from Diagnostics. Hosting tools that "just worked" usually created this rule and a router mapping silently; after switching tools, re-check both.

If outside players still cannot connect after the three steps, test the forward from a phone on mobile data, and confirm the public address shown in **Connect** matches the Connection doctor's detected IP (ISPs occasionally rotate addresses or move customers behind carrier-grade NAT, which breaks all port forwarding).

## Installation appears stuck

Server Hub warns after two minutes without progress. Cancel the job, then use **Repair and retry**. SteamCMD is reacquired when its managed files are cleared.

## Backup restore

Stop the server first. Open Backups, verify the archive, then review the restore preview. Restore remains disabled when checksum verification fails.

## Credentials cannot be decrypted

DPAPI credentials belong to the Windows account that protected them. Run Server Hub as the original user or use **Reset stored credentials** in Settings and enter replacement values. Do not delete the pre-DPAPI recovery backup until all servers have been tested.

## Safe information to share

Use the Support ZIP. Never share `%APPDATA%\ServerHub`, the SQLite database, worlds, raw configuration files, passwords, Player IDs, or tokens.

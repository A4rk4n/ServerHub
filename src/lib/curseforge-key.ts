// CurseForge API key storage: a 0600 JSON sidecar under app-data,
// deliberately outside the database and the support-bundle allowlist —
// the key is a personal capability token, exactly like the Discord
// webhook URL in notifications.json.

import fsp from "node:fs/promises";
import path from "node:path";
import { normalizeCurseforgeKey } from "./curseforge";
import { appDataDir } from "./storage";

function keyFile() {
  return path.join(appDataDir(), "curseforge.json");
}

export async function readCurseforgeKey(): Promise<string> {
  try {
    const raw = JSON.parse(await fsp.readFile(keyFile(), "utf8")) as { apiKey?: unknown };
    return normalizeCurseforgeKey(raw.apiKey);
  } catch {
    return "";
  }
}

export async function writeCurseforgeKey(apiKey: string): Promise<void> {
  await fsp.mkdir(appDataDir(), { recursive: true });
  await fsp.writeFile(keyFile(), JSON.stringify({ apiKey: normalizeCurseforgeKey(apiKey) }, null, 2), { encoding: "utf8", mode: 0o600 });
}

// Panel settings export/import: one JSON bundle of every panel-level
// configuration sidecar, for backups and for migrating to a new machine.
// Strict whitelist — the bundle carries configuration, never state:
//   - pin-lock.json is excluded on purpose (re-establish security locally;
//     never import a lock you might not be able to open),
//   - maintenance.json is excluded (a transient operational flag, not a
//     setting), and
//   - *-state.json files are excluded (runtime bookkeeping).
// The bundle DOES include the webhook URL and the status-page token —
// that is the point of a migration — so treat the file like a secret.
// Imported sections are written as-is: every consumer already normalizes
// on read, so junk inside a section degrades to defaults instead of
// breaking the panel.

import fsp from "node:fs/promises";
import path from "node:path";
import { appDataDir } from "./storage";

export const PANEL_SETTINGS_KIND = "serverhub-panel-settings";
export const PANEL_SETTINGS_VERSION = 1;

/** Section name → app-data file. The whitelist, in one place. */
export const SECTION_FILES = {
  notifications: "notifications.json",
  diskAlerts: "disk-alerts.json",
  logRetention: "log-retention.json",
  restartWarnings: "restart-warnings.json",
  announcements: "announcements.json",
  serverTags: "server-tags.json",
  statusPage: "status-page.json",
  backupMirror: "backup-mirror.json",
} as const;

export type PanelSettingsSection = keyof typeof SECTION_FILES;
export type PanelSettings = Partial<Record<PanelSettingsSection, Record<string, unknown> | null>>;

export type PanelSettingsBundle = {
  kind: typeof PANEL_SETTINGS_KIND;
  version: number;
  exportedAt: string;
  appVersion: string;
  settings: PanelSettings;
};

export function buildPanelSettingsBundle(settings: PanelSettings, appVersion: string, now = new Date()): PanelSettingsBundle {
  return { kind: PANEL_SETTINGS_KIND, version: PANEL_SETTINGS_VERSION, exportedAt: now.toISOString(), appVersion, settings };
}

export type BundleVerdict = { ok: true; bundle: PanelSettingsBundle } | { ok: false; problem: string };

export function verifyPanelSettingsBundle(raw: unknown): BundleVerdict {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, problem: "Not a settings bundle (expected a JSON object)" };
  const candidate = raw as Partial<PanelSettingsBundle>;
  if (candidate.kind !== PANEL_SETTINGS_KIND) return { ok: false, problem: "Not a Server Hub panel-settings bundle" };
  if (candidate.version !== PANEL_SETTINGS_VERSION) return { ok: false, problem: `Unsupported bundle version ${String(candidate.version)} (expected ${PANEL_SETTINGS_VERSION})` };
  if (typeof candidate.settings !== "object" || candidate.settings === null || Array.isArray(candidate.settings)) return { ok: false, problem: "The bundle has no settings object" };
  const settings: PanelSettings = {};
  for (const section of Object.keys(SECTION_FILES) as PanelSettingsSection[]) {
    const value = (candidate.settings as Record<string, unknown>)[section];
    if (value === undefined || value === null) continue;
    if (typeof value !== "object" || Array.isArray(value)) return { ok: false, problem: `Section "${section}" is not an object` };
    settings[section] = value as Record<string, unknown>;
  }
  return {
    ok: true,
    bundle: {
      kind: PANEL_SETTINGS_KIND,
      version: PANEL_SETTINGS_VERSION,
      exportedAt: typeof candidate.exportedAt === "string" ? candidate.exportedAt : "",
      appVersion: typeof candidate.appVersion === "string" ? candidate.appVersion : "",
      settings,
    },
  };
}

/** UTC-stamped download name: serverhub-panel-settings-20261002-104500.json */
export function panelSettingsFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `serverhub-panel-settings-${stamp}.json`;
}

// ---- filesystem ------------------------------------------------------------

export async function readPanelSettings(base?: string): Promise<PanelSettings> {
  const dir = base ?? appDataDir();
  const settings: PanelSettings = {};
  for (const [section, file] of Object.entries(SECTION_FILES) as [PanelSettingsSection, string][]) {
    try {
      const raw = JSON.parse(await fsp.readFile(path.join(dir, file), "utf8")) as unknown;
      settings[section] = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    } catch {
      settings[section] = null;
    }
  }
  return settings;
}

/** Writes every present section; returns the names applied. */
export async function writePanelSettings(settings: PanelSettings, base?: string): Promise<PanelSettingsSection[]> {
  const dir = base ?? appDataDir();
  await fsp.mkdir(dir, { recursive: true });
  const applied: PanelSettingsSection[] = [];
  for (const [section, file] of Object.entries(SECTION_FILES) as [PanelSettingsSection, string][]) {
    const value = settings[section];
    if (value === undefined || value === null) continue;
    // 0600 like the originals — the bundle can carry webhook URLs/tokens.
    await fsp.writeFile(path.join(dir, file), JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
    applied.push(section);
  }
  return applied;
}

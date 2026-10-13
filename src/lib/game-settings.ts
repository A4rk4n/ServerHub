// Gameplay settings: a curated, typed form over the server.properties
// keys the panel does NOT already own. The panel writes motd, port,
// bind address, max-players, difficulty, pvp, level-name and level-seed
// from the server record (writeServerConfig), and the roster owns
// white-list — so those keys are excluded here to avoid two writers
// fighting over one file. Everything else in the file (comments,
// unknown keys, mod-added settings) is preserved on save.

export type GameSettingField =
  | { key: string; label: string; hint: string; type: "enum"; options: string[]; fallback: string }
  | { key: string; label: string; hint: string; type: "boolean"; fallback: boolean }
  | { key: string; label: string; hint: string; type: "integer"; min: number; max: number; fallback: number };

/** Keys written from the server record or the roster — never from this form. */
export const PANEL_OWNED_KEYS = [
  "motd", "server-port", "server-ip", "max-players", "difficulty", "pvp",
  "level-name", "level-seed", "online-mode", "white-list",
] as const;

export const GAME_SETTING_FIELDS: GameSettingField[] = [
  { key: "gamemode", label: "Game mode", hint: "Mode assigned to players joining for the first time.", type: "enum", options: ["survival", "creative", "adventure", "spectator"], fallback: "survival" },
  { key: "force-gamemode", label: "Force game mode", hint: "Players always rejoin in the default game mode.", type: "boolean", fallback: false },
  { key: "hardcore", label: "Hardcore", hint: "Death is permanent — players become spectators.", type: "boolean", fallback: false },
  { key: "allow-flight", label: "Allow flight", hint: "Permit survival flight (mods often need this on).", type: "boolean", fallback: false },
  { key: "allow-nether", label: "Allow the Nether", hint: "Nether portals work.", type: "boolean", fallback: true },
  { key: "spawn-monsters", label: "Spawn monsters", hint: "Hostile mobs appear at night and in the dark.", type: "boolean", fallback: true },
  { key: "enable-command-block", label: "Command blocks", hint: "Command blocks can run commands.", type: "boolean", fallback: false },
  { key: "view-distance", label: "View distance", hint: "Chunks sent to each player. Higher costs RAM and bandwidth.", type: "integer", min: 3, max: 32, fallback: 10 },
  { key: "simulation-distance", label: "Simulation distance", hint: "Chunks around players that tick (mobs, crops, redstone).", type: "integer", min: 3, max: 32, fallback: 8 },
  { key: "spawn-protection", label: "Spawn protection radius", hint: "Blocks around spawn only operators can edit. 0 disables.", type: "integer", min: 0, max: 29999984, fallback: 16 },
  { key: "player-idle-timeout", label: "Idle kick (minutes)", hint: "Kick players idle this long. 0 never kicks.", type: "integer", min: 0, max: 1440, fallback: 0 },
];

/** Raw values for the curated keys found in a server.properties text. */
export function parseGameSettings(text: string | null): Record<string, string> {
  const raw: Record<string, string> = {};
  if (!text) return raw;
  const wanted = new Set(GAME_SETTING_FIELDS.map((field) => field.key));
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#!=\s]+)\s*=\s*(.*?)\s*$/);
    if (match && wanted.has(match[1]) && !(match[1] in raw)) raw[match[1]] = match[2];
  }
  return raw;
}

/** Typed current value for one field: the file's value when it parses, the vanilla fallback when absent or mangled. */
export function coerceGameSetting(field: GameSettingField, raw: string | undefined): string | number | boolean {
  if (raw === undefined) return field.fallback;
  if (field.type === "enum") return field.options.includes(raw) ? raw : field.fallback;
  if (field.type === "boolean") return raw === "true" ? true : raw === "false" ? false : field.fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= field.min && n <= field.max ? n : field.fallback;
}

export type GameSettingsValidation = {
  values: Record<string, string | number | boolean>;
  problems: string[];
};

/** Validate a submitted value set. Unknown and panel-owned keys are refused outright. */
export function validateGameSettings(input: Record<string, unknown>): GameSettingsValidation {
  const result: GameSettingsValidation = { values: {}, problems: [] };
  const byKey = new Map(GAME_SETTING_FIELDS.map((field) => [field.key, field]));
  for (const [key, value] of Object.entries(input)) {
    const field = byKey.get(key);
    if (!field) {
      result.problems.push((PANEL_OWNED_KEYS as readonly string[]).includes(key)
        ? `\`${key}\` is managed from the server settings form, not here`
        : `Unknown setting \`${key}\``);
      continue;
    }
    if (field.type === "enum") {
      if (typeof value !== "string" || !field.options.includes(value)) {
        result.problems.push(`${field.label}: expected one of ${field.options.join(", ")}`);
        continue;
      }
    } else if (field.type === "boolean") {
      if (typeof value !== "boolean") {
        result.problems.push(`${field.label}: expected true or false`);
        continue;
      }
    } else {
      if (typeof value !== "number" || !Number.isInteger(value) || value < field.min || value > field.max) {
        result.problems.push(`${field.label}: expected a whole number between ${field.min} and ${field.max}`);
        continue;
      }
    }
    result.values[key] = value as string | number | boolean;
  }
  return result;
}

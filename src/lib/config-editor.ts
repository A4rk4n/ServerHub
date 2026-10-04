// Config editor core: format detection, validation, diff preview, and
// safety-copy naming. Pure functions — safe to import from both the API
// routes (server) and the files manager (client).

export type ConfigFormat = "properties" | "yaml" | "toml" | "json";

export type ValidationResult =
  | { ok: true }
  | { ok: false; line: number | null; message: string };

export type DiffPreview = {
  changed: boolean;
  added: number;
  removed: number;
  /** 1-based line number (in the old file) where the changed region starts. */
  start: number;
  contextBefore: string[];
  removedLines: string[];
  addedLines: string[];
  contextAfter: string[];
};

export const SAFETY_COPY_PATTERN = /\.bak-\d{8}-\d{6}$/;
export const MAX_SAFETY_COPIES = 5;
const DIFF_CONTEXT = 3;

const FORMAT_BY_EXT: Record<string, ConfigFormat> = {
  properties: "properties",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  json: "json",
};

/** Detect the config format of a file by its extension (case-insensitive). */
export function detectConfigFormat(filePath: string): ConfigFormat | null {
  const name = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const base = name.replace(SAFETY_COPY_PATTERN, "");
  const ext = base.includes(".") ? base.split(".").pop() ?? "" : "";
  return FORMAT_BY_EXT[ext] ?? null;
}

/** True when the file name looks like a safety copy made before a config save. */
export function isSafetyCopy(filePath: string): boolean {
  return SAFETY_COPY_PATTERN.test(filePath.split(/[\\/]/).pop() ?? "");
}

/** Name for the safety copy written next to a config file before overwriting it. */
export function safetyCopyName(filePath: string, now: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${filePath}.bak-${stamp}`;
}

/** Validate config text for a detected format. Unknown formats always pass. */
export function validateConfig(format: ConfigFormat | null, text: string): ValidationResult {
  switch (format) {
    case "json":
      return validateJson(text);
    case "properties":
      return validateProperties(text);
    case "yaml":
      return validateYaml(text);
    case "toml":
      return validateToml(text);
    default:
      return { ok: true };
  }
}

function validateJson(text: string): ValidationResult {
  if (!text.trim()) return { ok: false, line: 1, message: "The file is empty — expected a JSON value" };
  try {
    JSON.parse(text);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let line: number | null = null;
    const lineMatch = message.match(/line (\d+)/i);
    if (lineMatch) {
      line = Number(lineMatch[1]);
    } else {
      const posMatch = message.match(/position (\d+)/i);
      if (posMatch) line = text.slice(0, Number(posMatch[1])).split("\n").length;
    }
    return { ok: false, line, message: message.replace(/^JSON\.parse: /, "") };
  }
}

function validateProperties(text: string): ValidationResult {
  const lines = text.split("\n");
  let continued = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (continued) {
      continued = /(?:^|[^\\])(\\\\)*\\$/.test(raw);
      continue;
    }
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) continue;
    if (trimmed.startsWith("=") || trimmed.startsWith(":")) {
      return { ok: false, line: i + 1, message: "Missing key before the separator" };
    }
    continued = /(?:^|[^\\])(\\\\)*\\$/.test(raw);
  }
  return { ok: true };
}

function unbalancedQuote(value: string): '"' | "'" | null {
  let single = false;
  let double = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\" && double) {
      i++;
      continue;
    }
    if (ch === '"' && !single) double = !double;
    else if (ch === "'" && !double) single = !single;
    else if (ch === "#" && !single && !double) break;
  }
  if (double) return '"';
  if (single) return "'";
  return null;
}

function validateYaml(text: string): ValidationResult {
  const lines = text.split("\n");
  let blockScalarIndent: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const indent = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (blockScalarIndent !== null) {
      if (!trimmed || indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^\t/.test(raw) || /^ *\t/.test(raw.slice(0, indent + 1))) {
      return { ok: false, line: i + 1, message: "YAML forbids tabs in indentation — use spaces" };
    }
    if (/[|>][+-]?\d*\s*(#.*)?$/.test(trimmed)) {
      blockScalarIndent = indent;
      continue;
    }
    const quote = unbalancedQuote(trimmed);
    if (quote) {
      return { ok: false, line: i + 1, message: `Unclosed ${quote === '"' ? "double" : "single"} quote` };
    }
  }
  return { ok: true };
}

function validateToml(text: string): ValidationResult {
  const lines = text.split("\n");
  let multiline: '"""' | "'''" | null = null;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (multiline) {
      if (trimmed.includes(multiline)) multiline = null;
      continue;
    }
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) {
      if (!/^\[\[?[^\][]+\]?\]\s*(#.*)?$/.test(trimmed) || /^\[\[[^\][]+\]\s*(#.*)?$/.test(trimmed)) {
        return { ok: false, line: i + 1, message: "Malformed table header — expected [section] or [[section]]" };
      }
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      return { ok: false, line: i + 1, message: "Expected a key = value pair, a [section] header, or a # comment" };
    }
    const value = trimmed.slice(eq + 1).trim();
    const opener = value.match(/^("""|''')/)?.[1] as '"""' | "'''" | undefined;
    if (opener && !value.slice(3).includes(opener)) {
      multiline = opener;
      continue;
    }
    const quote = unbalancedQuote(value);
    if (quote) {
      return { ok: false, line: i + 1, message: `Unclosed ${quote === '"' ? "double" : "single"} quote in value` };
    }
  }
  if (multiline) return { ok: false, line: lines.length, message: "Unterminated multi-line string" };
  return { ok: true };
}

/**
 * Line-based change preview: trims the common prefix and suffix and returns
 * the changed region with a few lines of context on each side.
 */
export function diffLines(before: string, after: string): DiffPreview {
  if (before === after) {
    return { changed: false, added: 0, removed: 0, start: 1, contextBefore: [], removedLines: [], addedLines: [], contextAfter: [] };
  }
  const a = before.split("\n");
  const b = after.split("\n");
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const removedLines = a.slice(prefix, a.length - suffix);
  const addedLines = b.slice(prefix, b.length - suffix);
  return {
    changed: true,
    added: addedLines.length,
    removed: removedLines.length,
    start: prefix + 1,
    contextBefore: a.slice(Math.max(0, prefix - DIFF_CONTEXT), prefix),
    removedLines,
    addedLines,
    contextAfter: a.slice(a.length - suffix, a.length - suffix + DIFF_CONTEXT),
  };
}

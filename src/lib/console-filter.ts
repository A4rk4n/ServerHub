// Pure console-view filtering and export helpers. Kept free of React and
// browser APIs so the exact lines a user sees — and downloads — are unit
// testable.

export type ConsoleLine = { id: number; ts: string; level: string; source: string; message: string };

export const CONSOLE_FILTERS = ["all", "info", "warn", "error", "command", "system"] as const;
export type ConsoleFilter = (typeof CONSOLE_FILTERS)[number];

// The warn pill intentionally includes errors: anyone triaging warnings
// must not have failures hidden one pill over.
export function matchesConsoleLevel(line: ConsoleLine, filter: ConsoleFilter): boolean {
  if (filter === "all") return true;
  if (filter === "warn") return line.level === "warn" || line.level === "error";
  return line.level === filter;
}

// Case-insensitive substring search over the message and the source tag.
// Level filter and search compose; a blank query matches everything.
export function filterConsoleLines(lines: ConsoleLine[], filter: ConsoleFilter, query: string): ConsoleLine[] {
  const needle = query.trim().toLowerCase();
  return lines.filter(
    (line) =>
      matchesConsoleLevel(line, filter) &&
      (!needle || line.message.toLowerCase().includes(needle) || line.source.toLowerCase().includes(needle))
  );
}

// Plain-text export of exactly the visible slice, one line per entry.
export function formatConsoleSlice(lines: ConsoleLine[]): string {
  if (lines.length === 0) return "";
  return lines.map((line) => `${line.ts} [${line.level.toUpperCase()}] [${line.source}] ${line.message}`).join("\n") + "\n";
}

export function consoleSliceFileName(serverId: number, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[T:]/g, "-");
  return `serverhub-${serverId}-console-${stamp}.log`;
}

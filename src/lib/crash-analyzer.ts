// Crash analyzer: turns the tail of a crashed server's console output
// (plus exit code/signal) into a plain-language diagnosis with a
// concrete fix. Pure and ordered — the first matching rule wins, and
// rules are sorted by how specific their evidence is. No match still
// produces a generic diagnosis so the incident is never empty.

export type CrashContext = {
  exitCode: number | null;
  signal: string | null;
  gameId?: string;
  memoryMb?: number;
};

export type CrashDiagnosis = {
  cause: string;
  title: string;
  detail: string;
  fix: string;
  matchedLine: string;
};

type Rule = {
  cause: string;
  title: string;
  patterns: RegExp[];
  fix: (context: CrashContext) => string;
};

const RULES: Rule[] = [
  {
    cause: "eula",
    title: "The Minecraft EULA has not been accepted",
    patterns: [/You need to agree to the EULA/i, /Failed to load eula\.txt/i],
    fix: () => "Open eula.txt in the server directory (Files tab) and set eula=true, then start the server again.",
  },
  {
    cause: "out-of-memory",
    title: "The server ran out of memory",
    patterns: [/java\.lang\.OutOfMemoryError/i, /GC overhead limit exceeded/i, /Cannot allocate memory/i, /insufficient memory for the Java Runtime/i],
    fix: (context) =>
      `Raise the memory limit in Settings${context.memoryMb ? ` (currently ${context.memoryMb} MB)` : ""}, or reduce the load: lower view-distance, trim mods/plugins, or shrink the world border.`,
  },
  {
    cause: "port-in-use",
    title: "The server port is already taken",
    patterns: [/Address already in use/i, /FAILED TO BIND TO PORT/i, /EADDRINUSE/i, /Could not bind to \S+/i],
    fix: () => "Another program (or another server) is using this port. Change the port in Settings, or stop whatever is holding it.",
  },
  {
    cause: "wrong-java",
    title: "The Java version is too old for this server",
    patterns: [/UnsupportedClassVersionError/i, /class file version \d+/i, /requires (?:Java|a newer) /i],
    fix: () => "Server Hub normally picks the right runtime — use Diagnostics → Tool Health to repair the bundled Java, or clear a custom Java path in Settings.",
  },
  {
    cause: "corrupted-world",
    title: "World data appears to be corrupted",
    patterns: [/Exception reading .*\.mca/i, /ChunkIO/i, /Failed to load level/i, /level\.dat.*(corrupt|failed|exception)/i, /RegionFile.*(corrupt|truncated)/i],
    fix: () => "Restore the world from a backup (Backups tab — you can browse an archive and restore single region files), or remove the damaged region file and let the server regenerate that area.",
  },
  {
    cause: "mod-conflict",
    title: "A mod or plugin failed to load",
    patterns: [/Mixin apply .*failed/i, /ModResolutionException/i, /Incompatible mod set/i, /Could not load plugin/i, /DuplicateModsFoundException/i, /mod .* requires/i],
    fix: () => "The log names the offending mod/plugin right above the crash. Remove or update it (Files tab → mods or plugins folder), then start again.",
  },
  {
    cause: "missing-file",
    title: "A file the launch command needs is missing",
    patterns: [/Unable to access jarfile/i, /No such file or directory/i, /ENOENT/i, /The system cannot find the (?:file|path)/i],
    fix: () => "Check the launch command and working directory in Settings — the executable or JAR it points at does not exist. Re-install the server if files were deleted.",
  },
  {
    cause: "disk-full",
    title: "The disk is full",
    patterns: [/No space left on device/i, /There is not enough space on the disk/i],
    fix: () => "Free up disk space — pruning old backups (Backups tab → retention) is usually the quickest win — then start the server again.",
  },
];

const MAX_SCAN_LINES = 120;

export function analyzeCrash(logTail: string[], context: CrashContext): CrashDiagnosis {
  const lines = logTail.slice(-MAX_SCAN_LINES);
  for (const rule of RULES) {
    // Scan newest-first so the matched line is the closest evidence
    // to the actual exit.
    for (let index = lines.length - 1; index >= 0; index--) {
      const line = lines[index];
      if (rule.patterns.some((pattern) => pattern.test(line))) {
        return {
          cause: rule.cause,
          title: rule.title,
          detail: `Evidence from the console: "${line.trim().slice(0, 240)}"`,
          fix: rule.fix(context),
          matchedLine: line.trim().slice(0, 240),
        };
      }
    }
  }
  // Signal/exit-code-only diagnoses when the log says nothing useful.
  if (context.signal === "SIGKILL") {
    return {
      cause: "killed",
      title: "The process was force-killed",
      detail: "The server did not crash on its own — something ended it (Task Manager, the OS out-of-memory killer, or a watchdog).",
      fix: "If this happens under load, raise the memory limit in Settings; the operating system kills processes that exceed available RAM.",
      matchedLine: "",
    };
  }
  return {
    cause: "unknown",
    title: `The server exited unexpectedly (code ${context.exitCode ?? "none"}${context.signal ? `, signal ${context.signal}` : ""})`,
    detail: "The console tail did not match a known crash pattern.",
    fix: "Open the Console tab and read the last lines before the exit; the Support Bundle in Diagnostics packages everything if you want help.",
    matchedLine: "",
  };
}

export const CRASH_RULE_CAUSES = RULES.map((rule) => rule.cause);

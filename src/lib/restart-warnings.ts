// Restart countdown warnings: before a *scheduled* stop or restart,
// players get in-game broadcasts ("Server restarts in 5 minutes…") at
// configurable intervals, and the power action runs when the countdown
// reaches zero. Pure logic here — the runtime owns timers and delivery.

export type WarningAction = "stop" | "restart";

export type WarningConfig = {
  enabled: boolean;
  /** Seconds-before-action marks, e.g. [600, 300, 60, 30]. Longest = total countdown. */
  intervalsSec: number[];
  /** Optional per-server broadcast template containing "{message}" — overrides the built-in. */
  template: string;
};

export const DEFAULT_WARNING_INTERVALS = [600, 300, 60, 30];
export const DEFAULT_WARNING_CONFIG: WarningConfig = { enabled: true, intervalsSec: DEFAULT_WARNING_INTERVALS, template: "" };

export const MIN_WARNING_SEC = 5;
export const MAX_WARNING_SEC = 3600;
export const MAX_WARNING_STEPS = 8;

export function normalizeWarningConfig(raw: unknown): WarningConfig {
  const candidate = (raw ?? {}) as Partial<WarningConfig>;
  const intervals = Array.isArray(candidate.intervalsSec)
    ? [...new Set(
        candidate.intervalsSec
          .filter((value): value is number => typeof value === "number" && Number.isInteger(value))
          .filter((value) => value >= MIN_WARNING_SEC && value <= MAX_WARNING_SEC)
      )]
        .sort((a, b) => b - a)
        .slice(0, MAX_WARNING_STEPS)
    : DEFAULT_WARNING_INTERVALS;
  let template = typeof candidate.template === "string" ? candidate.template.trim() : "";
  if (template && (!template.includes("{message}") || template.length > 200 || /[\r\n\x00]/.test(template))) template = "";
  return {
    enabled: candidate.enabled !== false,
    intervalsSec: intervals.length > 0 ? intervals : DEFAULT_WARNING_INTERVALS,
    template,
  };
}

/** Games whose consoles have a built-in broadcast command. */
export function builtinBroadcastCommand(gameId: string): string | null {
  if (gameId.startsWith("minecraft")) return "say {message}";
  if (gameId === "terraria") return "say {message}";
  if (gameId === "rust") return "say {message}";
  return null;
}

/**
 * The console command that broadcasts `message`, or null when this server
 * has no way to reach players (then the action runs immediately instead).
 * A configured template always wins — it is how custom servers opt in.
 */
export function broadcastCommand(gameId: string, template: string, message: string): string | null {
  const shape = template || builtinBroadcastCommand(gameId);
  if (!shape) return null;
  return shape.replaceAll("{message}", message);
}

export function humanizeSeconds(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

export function warningMessage(action: WarningAction, secondsLeft: number): string {
  return `Server will ${action === "stop" ? "shut down" : "restart"} in ${humanizeSeconds(secondsLeft)}`;
}

export type CountdownPlan = {
  totalSec: number;
  /** Ascending by time; the first step fires immediately. */
  steps: Array<{ atMs: number; secondsLeft: number }>;
  actionAtMs: number;
};

/** Longest interval = total countdown; each mark fires at (total − mark). */
export function countdownPlan(intervalsSec: number[], nowMs: number): CountdownPlan {
  const sorted = [...intervalsSec].sort((a, b) => b - a);
  const totalSec = sorted[0] ?? 0;
  return {
    totalSec,
    steps: sorted.map((secondsLeft) => ({ atMs: nowMs + (totalSec - secondsLeft) * 1000, secondsLeft })),
    actionAtMs: nowMs + totalSec * 1000,
  };
}

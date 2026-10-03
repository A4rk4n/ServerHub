// Power schedules: scheduled "start" and "stop" task types plus the
// power-window helper that creates a matched daily pair ("up 15:00,
// down 23:00"). Pure logic only — the scheduler sweep executes the
// decisions through the normal start/stop flows.

export type PowerTaskType = "start" | "stop";

export function validDailyTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

// Skip semantics: a scheduled start on a running server (or stop on a
// stopped or already-stopping one) is a satisfied wish, not an error.
// It records a skipped run with the reason instead of failing or
// churning the process.
export function powerTaskDecision(type: PowerTaskType, running: boolean, stopping = false): { action: "run" | "skip"; reason: string } {
  if (type === "start" && running) return { action: "skip", reason: "Server is already running" };
  if (type === "stop" && !running) return { action: "skip", reason: "Server is already offline" };
  if (type === "stop" && stopping) return { action: "skip", reason: "Server is already stopping" };
  return { action: "run", reason: "" };
}

export type PowerWindowTask = {
  name: string;
  type: PowerTaskType;
  scheduleKind: "daily";
  scheduleTime: string;
  missedPolicy: "run" | "skip";
};

// Builds the matched daily pair for a power window. Overnight windows
// (stop before start, e.g. 18:00-01:00) are naturally fine because the
// two tasks are independent daily schedules.
export function powerWindowPlan(startTime: string, stopTime: string): PowerWindowTask[] {
  if (!validDailyTime(startTime) || !validDailyTime(stopTime)) throw new Error("Times must be HH:MM (24-hour)");
  if (startTime === stopTime) throw new Error("Start and stop times must differ");
  return [
    { name: `Power on at ${startTime}`, type: "start", scheduleKind: "daily", scheduleTime: startTime, missedPolicy: "run" },
    // A missed stop still runs late: the window's promise is "the
    // server is down outside the window", so catching up matters.
    { name: `Power off at ${stopTime}`, type: "stop", scheduleKind: "daily", scheduleTime: stopTime, missedPolicy: "run" },
  ];
}

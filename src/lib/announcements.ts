// Scheduled announcements: rotating in-game broadcasts ("Join our Discord…",
// "Backups run nightly…") sent to online players on a per-server interval.
// Reuses the restart-warning broadcast plumbing: a game's built-in `say`
// command, or the custom {message} template for anything exotic. Pure logic
// here — the runtime owns the sweep timer and delivery.

export type AnnouncementOrder = "sequential" | "random";

export type AnnouncementConfig = {
  enabled: boolean;
  /** Minutes between broadcasts. */
  intervalMin: number;
  /** Rotation order across `messages`. */
  order: AnnouncementOrder;
  /** Optional broadcast template containing "{message}" — overrides the built-in. */
  template: string;
  /** The rotation, broadcast one at a time. */
  messages: string[];
};

export const MIN_ANNOUNCE_INTERVAL_MIN = 1;
export const MAX_ANNOUNCE_INTERVAL_MIN = 1440;
export const MAX_ANNOUNCE_MESSAGES = 20;
export const MAX_ANNOUNCE_MESSAGE_LENGTH = 200;

export const DEFAULT_ANNOUNCEMENT_CONFIG: AnnouncementConfig = {
  enabled: false,
  intervalMin: 30,
  order: "sequential",
  template: "",
  messages: [],
};

export function normalizeAnnouncementConfig(raw: unknown): AnnouncementConfig {
  const candidate = (raw ?? {}) as Partial<AnnouncementConfig>;
  const intervalMin = Number.isInteger(candidate.intervalMin)
    ? Math.min(MAX_ANNOUNCE_INTERVAL_MIN, Math.max(MIN_ANNOUNCE_INTERVAL_MIN, candidate.intervalMin as number))
    : DEFAULT_ANNOUNCEMENT_CONFIG.intervalMin;
  const messages = Array.isArray(candidate.messages)
    ? candidate.messages
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0 && value.length <= MAX_ANNOUNCE_MESSAGE_LENGTH && !/[\r\n\x00]/.test(value))
        .slice(0, MAX_ANNOUNCE_MESSAGES)
    : [];
  let template = typeof candidate.template === "string" ? candidate.template.trim() : "";
  if (template && (!template.includes("{message}") || template.length > 200 || /[\r\n\x00]/.test(template))) template = "";
  return {
    enabled: candidate.enabled === true && messages.length > 0,
    intervalMin,
    order: candidate.order === "random" ? "random" : "sequential",
    template,
    messages,
  };
}

/**
 * The index to broadcast next. Sequential wraps around; random never repeats
 * the previous message when there is more than one to choose from.
 */
export function nextAnnouncementIndex(order: AnnouncementOrder, lastIndex: number, count: number, rand: () => number = Math.random): number {
  if (count <= 0) return -1;
  if (count === 1) return 0;
  if (order === "sequential") {
    const previous = Number.isInteger(lastIndex) && lastIndex >= 0 && lastIndex < count ? lastIndex : -1;
    return (previous + 1) % count;
  }
  let pick = Math.min(count - 1, Math.floor(rand() * count));
  if (pick === lastIndex) pick = (pick + 1) % count;
  return pick;
}

/** True once a full interval has elapsed since the last broadcast. */
export function isAnnouncementDue(nowMs: number, lastSentAtMs: number, intervalMin: number): boolean {
  return nowMs - lastSentAtMs >= intervalMin * 60_000;
}

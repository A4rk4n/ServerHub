// Fleet-wide search: one query across servers, players, backups, and the
// activity feed. This module is the pure core — query normalization,
// match scoring, highlight ranges, and group ranking — shared by the
// /api/search route (which feeds it DB rows) and the search page (which
// highlights matches). Client-portable: no node: imports.

export type SearchHitType = "server" | "player" | "backup" | "activity";

export type SearchHit = {
  type: SearchHitType;
  id: number;
  title: string;
  subtitle: string;
  href: string;
  score: number;
  /** Epoch ms used to break score ties — newer wins. */
  at: number;
};

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 80;
export const GROUP_LIMITS: Record<SearchHitType, number> = { server: 5, player: 5, backup: 5, activity: 10 };

/** Trim, collapse inner whitespace, cap length; too-short queries become "". */
export function normalizeQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const query = raw.trim().replace(/\s+/g, " ").slice(0, MAX_QUERY_LENGTH);
  return query.length >= MIN_QUERY_LENGTH ? query : "";
}

/**
 * Case-insensitive relevance: exact (100) > prefix (80) > word start (60)
 * > substring (40) > none (0).
 */
export function scoreMatch(query: string, text: string): number {
  if (!query || !text) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  const index = t.indexOf(q);
  if (index < 0) return 0;
  const boundary = /[\s\-_./:("']/.test(t[index - 1] ?? "");
  return boundary ? 60 : 40;
}

/** [start, end) of the first case-insensitive occurrence, for highlighting. */
export function matchRange(query: string, text: string): [number, number] | null {
  if (!query || !text) return null;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  return index < 0 ? null : [index, index + query.length];
}

/** Keep real matches, best first (score desc, then newer), capped per group. */
export function rankGroup(hits: SearchHit[], limit: number): SearchHit[] {
  return hits
    .filter((hit) => hit.score > 0)
    .sort((a, b) => (b.score - a.score) || (b.at - a.at) || (a.id - b.id))
    .slice(0, Math.max(0, limit));
}

/** Best score across several fields of one record (name beats note, etc.). */
export function bestScore(query: string, fields: string[]): number {
  let best = 0;
  for (const field of fields) best = Math.max(best, scoreMatch(query, field));
  return best;
}

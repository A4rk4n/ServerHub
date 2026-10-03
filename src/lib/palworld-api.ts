// Client for the official Palworld dedicated-server REST API — the
// supported admin surface (RCON is deprecated by Pocketpair). Palworld
// ignores stdin, so without this API a stop means force-killing the
// process and risking world-save corruption. The API speaks plain HTTP
// with Basic auth (username is literally "admin", password is the
// server's AdminPassword); Server Hub only ever calls it over loopback
// and never opens a firewall rule for it.

export function palworldRestPort(gamePort: number): number {
  // One REST port per server, derived from the game port so multiple
  // Palworld servers never collide. The defaults line up with the
  // game's own conventions: game 8211 → REST 8212.
  return gamePort + 1;
}

export function palworldAuthorization(adminPassword: string): string {
  return `Basic ${Buffer.from(`admin:${adminPassword}`).toString("base64")}`;
}

export type PalworldRequest = { url: string; init: RequestInit };

export function palworldApiRequest(restPort: number, endpoint: string, adminPassword: string, body?: object): PalworldRequest {
  return {
    // Loopback only: the credential travels base64-encoded over plain
    // HTTP, so this must never target a routable address.
    url: `http://127.0.0.1:${restPort}/v1/api/${endpoint}`,
    init: {
      method: "POST",
      headers: { Authorization: palworldAuthorization(adminPassword), "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(4000),
    },
  };
}

export type PalworldStopResult = { saved: boolean; shutdown: boolean };

/**
 * Graceful stop: force a world save, then request a shutdown with an
 * in-game countdown so players see it coming. Both calls are bounded and
 * best-effort — the caller keeps its force-kill backstop either way.
 * Returns which of the two steps the server accepted.
 */
export async function palworldGracefulStop(options: {
  gamePort: number;
  adminPassword: string;
  waitSeconds?: number;
  message?: string;
  fetchImpl?: typeof fetch;
}): Promise<PalworldStopResult> {
  const { gamePort, adminPassword, waitSeconds = 10, fetchImpl = fetch } = options;
  const message = options.message ?? `Server Hub is stopping this server in ${waitSeconds} seconds.`;
  // Without an admin password the API rejects everything; don't even try.
  if (!adminPassword) return { saved: false, shutdown: false };
  const restPort = palworldRestPort(gamePort);
  let saved = false;
  let shutdown = false;
  try {
    const save = palworldApiRequest(restPort, "save", adminPassword);
    saved = (await fetchImpl(save.url, save.init)).ok;
  } catch {
    /* REST disabled, server already gone, or timed out */
  }
  try {
    const stop = palworldApiRequest(restPort, "shutdown", adminPassword, { waittime: waitSeconds, message });
    shutdown = (await fetchImpl(stop.url, stop.init)).ok;
  } catch {
    /* fall back to the caller's termination path */
  }
  return { saved, shutdown };
}

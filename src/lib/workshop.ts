// Steam Workshop integration: track Workshop items (mods, worlds,
// packs) against a Steam game's server, with live metadata from the
// public GetPublishedFileDetails endpoint — no API key required.
// Tracked items manage no local file (Workshop content is fetched by
// SteamCMD or the game itself); the value is the curated list, update
// detection against time_updated, and the generated activation
// config/commands. Pure helpers here; routes own fetch + database.

export type WorkshopDetails = {
  fileId: string;
  title: string;
  description: string;
  timeUpdated: number;
  subscriptions: number;
  consumerAppId: number;
  fileSize: number;
};

/** The addons-table `source` value marking a tracked Workshop item. */
export const WORKSHOP_SOURCE = "Steam Workshop";

/** Where the Steam Web API lives — overridable for tests/mocks. */
export function steamApiBase(): string {
  return (process.env.SERVERHUB_STEAM_API_BASE ?? "https://api.steampowered.com").replace(/\/$/, "");
}

/** Accepts a bare numeric id or any steamcommunity.com item URL. */
export function parseWorkshopInput(input: string): string | null {
  const text = input.trim();
  if (/^\d{1,18}$/.test(text)) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!/(^|\.)steamcommunity\.com$/.test(url.hostname)) return null;
  const id = url.searchParams.get("id");
  return id && /^\d{1,18}$/.test(id) ? id : null;
}

/** POST body for GetPublishedFileDetails (form-encoded, indexed ids). */
export function detailsRequestBody(ids: string[]): URLSearchParams {
  const body = new URLSearchParams();
  body.set("itemcount", String(ids.length));
  ids.forEach((id, index) => body.set(`publishedfileids[${index}]`, id));
  return body;
}

/** Map one raw publishedfiledetails entry; null when Steam reports it unavailable. */
export function mapPublishedFile(raw: Record<string, unknown>): WorkshopDetails | null {
  if (Number(raw.result) !== 1) return null;
  const fileId = String(raw.publishedfileid ?? "");
  if (!/^\d+$/.test(fileId)) return null;
  return {
    fileId,
    title: typeof raw.title === "string" && raw.title ? raw.title : `Workshop item ${fileId}`,
    description: typeof raw.description === "string" ? raw.description.replace(/\s+/g, " ").trim().slice(0, 240) : "",
    timeUpdated: Number(raw.time_updated) || 0,
    subscriptions: Number(raw.subscriptions ?? raw.lifetime_subscriptions) || 0,
    consumerAppId: Number(raw.consumer_app_id) || 0,
    fileSize: Number(raw.file_size) || 0,
  };
}

/** Fetch details for up to 50 items. Throws on transport errors; items Steam
 *  can't serve (deleted, private) are simply absent from the result. */
export async function fetchWorkshopDetails(ids: string[]): Promise<Map<string, WorkshopDetails>> {
  const out = new Map<string, WorkshopDetails>();
  if (ids.length === 0) return out;
  const response = await fetch(`${steamApiBase()}/ISteamRemoteStorage/GetPublishedFileDetails/v1/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: detailsRequestBody(ids.slice(0, 50)).toString(),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Steam API responded ${response.status}`);
  const json = (await response.json()) as { response?: { publishedfiledetails?: Record<string, unknown>[] } };
  for (const raw of json.response?.publishedfiledetails ?? []) {
    const mapped = mapPublishedFile(raw);
    if (mapped) out.set(mapped.fileId, mapped);
  }
  return out;
}

/** The SteamCMD one-liner that downloads an item's content. */
export function steamcmdDownloadCommand(workshopAppId: number, fileId: string): string {
  return `steamcmd +login anonymous +workshop_download_item ${workshopAppId} ${fileId} +quit`;
}

/** Game-specific activation guidance for the currently enabled items. */
export function activationFor(gameId: string, enabledIds: string[]): { line: string | null; hint: string } {
  if (gameId === "ark") {
    return {
      line: `ActiveMods=${enabledIds.join(",")}`,
      hint: "Add this line under [ServerSettings] in GameUserSettings.ini — mod order matters. SteamCMD downloads land in steamapps/workshop/content/346110/<item id>; link or copy each into ShooterGame/Content/Mods.",
    };
  }
  if (gameId === "terraria") {
    return {
      line: null,
      hint: "Downloads land in steamapps/workshop/content/105600/<item id>. Copy world files (.wld) into the server's Worlds folder and select them with the `world` setting in serverconfig.txt.",
    };
  }
  return { line: null, hint: "Download each item with SteamCMD and follow the game's own mod installation layout." };
}

/** Update verdict: stored `version` holds the time_updated at install time. */
export function workshopUpdateStatus(storedVersion: string, latest: WorkshopDetails | undefined): "update" | "current" | "unknown" {
  if (!latest) return "unknown";
  const installed = Number(storedVersion) || 0;
  return latest.timeUpdated > installed ? "update" : "current";
}

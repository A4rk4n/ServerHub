import { NextResponse } from "next/server";
import { APP_VERSION, LATEST_RELEASE_API, RELEASES_PAGE, extractLatestRelease, isNewerVersion } from "@/lib/update-check";

export const dynamic = "force-dynamic";

type UpdateStatus = {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  url: string;
  publishedAt: string | null;
  checkedAt: string;
};

// Successful checks are cached for six hours, failures for ten minutes, so
// the UI can poll freely without hammering the GitHub API (60 req/h
// unauthenticated) and a temporary outage retries reasonably soon.
const OK_TTL_MS = 6 * 60 * 60 * 1000;
const FAIL_TTL_MS = 10 * 60 * 1000;
let cache: { at: number; status: UpdateStatus } | null = null;

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < (cache.status.latest !== null ? OK_TTL_MS : FAIL_TTL_MS)) {
    return NextResponse.json(cache.status);
  }
  let latest: ReturnType<typeof extractLatestRelease> = null;
  try {
    const response = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `ServerHub/${APP_VERSION}` },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    // 404 simply means the repository has no published releases yet.
    if (response.ok) latest = extractLatestRelease(await response.json());
  } catch {
    /* offline or rate-limited: report no update, retry after FAIL_TTL */
  }
  const status: UpdateStatus = {
    current: APP_VERSION,
    latest: latest?.version ?? null,
    updateAvailable: latest !== null && isNewerVersion(APP_VERSION, latest.version),
    url: latest?.url ?? RELEASES_PAGE,
    publishedAt: latest?.publishedAt ?? null,
    checkedAt: new Date(now).toISOString(),
  };
  cache = { at: now, status };
  return NextResponse.json(status);
}

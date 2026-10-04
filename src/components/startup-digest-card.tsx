"use client";

import { Sunrise, X } from "lucide-react";
import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/format";

type Digest = {
  offlineMs: number | null;
  interrupted: number;
  counts: { crashes: number; autoRestarts: number; restartLimits: number; backupFailures: number; diskAlerts: number; guardrails: number; security: number };
  notable: { kind: string; message: string; ts: number }[];
};

function gap(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under a minute";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
  return `${mins} min`;
}

export function StartupDigestCard() {
  const [digest, setDigest] = useState<Digest | null>(null);

  useEffect(() => {
    void fetch("/api/overview/startup-digest", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setDigest(j.digest ?? null))
      .catch(() => {});
  }, []);

  if (!digest) return null;

  const c = digest.counts;
  const parts: string[] = [];
  if (c.crashes > 0) parts.push(`${c.crashes} crash${c.crashes === 1 ? "" : "es"}`);
  if (c.autoRestarts > 0) parts.push(`${c.autoRestarts} watchdog restart${c.autoRestarts === 1 ? "" : "s"}`);
  if (c.restartLimits > 0) parts.push(`${c.restartLimits} restart limit${c.restartLimits === 1 ? "" : "s"} hit`);
  if (c.backupFailures > 0) parts.push(`${c.backupFailures} backup problem${c.backupFailures === 1 ? "" : "s"}`);
  if (c.diskAlerts > 0) parts.push(`${c.diskAlerts} low-disk alert${c.diskAlerts === 1 ? "" : "s"}`);
  if (c.guardrails > 0) parts.push(`${c.guardrails} guardrail trip${c.guardrails === 1 ? "" : "s"}`);
  if (c.security > 0) parts.push(`${c.security} security event${c.security === 1 ? "" : "s"}`);

  return (
    <section className="panel relative p-5">
      <button
        type="button"
        aria-label="Dismiss"
        className="absolute right-3 top-3 rounded-lg p-1 text-plum-400 transition hover:bg-candy-50 hover:text-plum-600"
        onClick={() => {
          setDigest(null);
          void fetch("/api/overview/startup-digest", { method: "DELETE" }).catch(() => {});
        }}
      >
        <X size={14} />
      </button>
      <h3 className="mb-1 flex items-center gap-2 font-semibold">
        <Sunrise size={15} className="text-plum-500" /> Since your last session
      </h3>
      <p className="text-sm text-plum-500">
        {digest.offlineMs !== null ? `The panel was off for ${gap(digest.offlineMs)}.` : "First session on this machine."}{" "}
        {digest.interrupted > 0 && (
          <span className="font-medium text-amber-600">
            {digest.interrupted} server{digest.interrupted === 1 ? " was" : "s were"} still running when the last session ended — marked crashed and left stopped.
          </span>
        )}{" "}
        {parts.length > 0 ? `Last session: ${parts.join(" · ")}.` : digest.interrupted === 0 ? "Last session was quiet." : ""}
      </p>
      {digest.notable.length > 0 && (
        <div className="mt-3 space-y-1">
          {digest.notable.map((n, i) => (
            <div key={`${n.ts}-${i}`} className="flex items-center gap-2 rounded-lg border border-candy-100 px-2.5 py-1.5 text-xs">
              <span className="inline-flex shrink-0 rounded-full bg-plum-50 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-plum-600">{n.kind}</span>
              <span className="truncate text-plum-700">{n.message}</span>
              <span className="ml-auto shrink-0 text-plum-400">{timeAgo(n.ts)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

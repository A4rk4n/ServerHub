"use client";

import { History, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Btn, Spin } from "./ui";
import { timeAgo } from "@/lib/format";

type Entry = { ts: number; ip: string; agent: string; kind: string; path: string };
type Summary = { visits24h: number; locked24h: number; unlockFails24h: number; unlockOks24h: number; denied24h: number; agents24h: string[]; lastVisit: number | null };

const KIND_LABEL: Record<string, { text: string; cls: string }> = {
  visit: { text: "visit", cls: "bg-plum-50 text-plum-600" },
  locked: { text: "locked", cls: "bg-amber-50 text-amber-600" },
  "unlock-ok": { text: "unlock", cls: "bg-emerald-50 text-emerald-600" },
  "unlock-fail": { text: "wrong PIN", cls: "bg-red-50 text-red-500" },
  denied: { text: "rejected", cls: "bg-red-50 text-red-500" },
};

export function AccessLogPanel() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const j = await fetch("/api/security/access-log", { cache: "no-store" }).then((r) => r.json());
      setEntries(j.entries ?? []);
      setSummary(j.summary ?? null);
    } catch {
      setEntries([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function clearLog() {
    setBusy(true);
    try {
      await fetch("/api/security/access-log", { method: "DELETE" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (entries === null) return <section className="panel p-5"><Spin label="Loading access log…" /></section>;

  return (
    <section className="panel p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-semibold">
          <History size={15} className="text-plum-500" /> Panel access log
        </h3>
        {entries.length > 0 && (
          <Btn variant="ghost" loading={busy} onClick={() => void clearLog()}>
            <Trash2 size={13} /> Clear
          </Btn>
        )}
      </div>
      <p className="mb-3 text-sm text-plum-500">
        When the panel was opened on this PC, by which browser, and every PIN unlock attempt or rejected non-local request — so a
        shared machine still has a timeline of who poked at the server controls.
      </p>
      {summary && (
        <p className="mb-3 text-xs text-plum-500">
          Last 24h: {summary.visits24h} visits · {summary.unlockOks24h} unlocks · {summary.unlockFails24h} wrong PINs · {summary.locked24h} lock-screen hits ·{" "}
          {summary.denied24h} rejected{summary.agents24h.length > 0 ? ` · browsers: ${summary.agents24h.join(", ")}` : ""}
        </p>
      )}
      {entries.length === 0 ? (
        <p className="text-sm text-plum-400">No access recorded yet — entries appear as the panel is used.</p>
      ) : (
        <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {entries.slice(0, 120).map((e, i) => {
            const label = KIND_LABEL[e.kind] ?? { text: e.kind, cls: "bg-plum-50 text-plum-600" };
            return (
              <div key={`${e.ts}-${i}`} className="flex items-center gap-2 rounded-lg border border-candy-100 px-2.5 py-1.5 text-xs">
                <span className={`inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider ${label.cls}`}>{label.text}</span>
                <span className="font-medium text-plum-700">{e.agent}</span>
                <span className="truncate text-plum-400">{e.path}</span>
                <span className="ml-auto shrink-0 text-plum-400">{timeAgo(e.ts)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

"use client";

import { ClipboardCheck, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Btn, Spin } from "./ui";

type Card = {
  uptimePct: number | null;
  crashes: number;
  watchdogSaves: number;
  restartLimits: number;
  backupsTotal: number;
  backupsFailed: number;
  backupSuccessPct: number | null;
  uniquePlayers: number;
  peakConcurrent: number;
  playtimeHours: number;
  verdict: "solid" | "good" | "attention" | "quiet";
};

const VERDICT_UI: Record<Card["verdict"], { text: string; cls: string }> = {
  solid: { text: "Rock solid", cls: "bg-emerald-50 text-emerald-600" },
  good: { text: "Mostly healthy", cls: "bg-sky-50 text-sky-600" },
  attention: { text: "Needs attention", cls: "bg-amber-50 text-amber-600" },
  quiet: { text: "No data yet", cls: "bg-plum-50 text-plum-500" },
};

export function ReportCardPanel({ serverId }: { serverId: number }) {
  const [card, setCard] = useState<Card | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    void fetch(`/api/servers/${serverId}/report-card`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setCard(j.card ?? null))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [serverId]);

  async function send() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await fetch(`/api/servers/${serverId}/report-card`, { method: "POST" });
      const j = await r.json();
      setNotice(r.ok ? { text: "Report sent to your webhook.", ok: true } : { text: j.error ?? "Could not send the report.", ok: false });
    } catch {
      setNotice({ text: "Could not send the report.", ok: false });
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <section className="panel p-5"><Spin label="Building weekly report…" /></section>;
  if (!card) return null;

  const verdict = VERDICT_UI[card.verdict];
  const stats: { label: string; value: string }[] = [
    { label: "Uptime (7 d)", value: card.uptimePct === null ? "—" : `${card.uptimePct}%` },
    { label: "Crashes", value: String(card.crashes) },
    { label: "Watchdog saves", value: String(card.watchdogSaves) },
    { label: "Backups", value: card.backupsTotal === 0 ? "—" : `${card.backupsTotal - card.backupsFailed}/${card.backupsTotal}` },
    { label: "Unique players", value: String(card.uniquePlayers) },
    { label: "Peak online", value: String(card.peakConcurrent) },
    { label: "Hours played", value: `${card.playtimeHours} h` },
  ];

  return (
    <section className="panel p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-semibold">
          <ClipboardCheck size={15} className="text-plum-500" /> Weekly report card
        </h3>
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider ${verdict.cls}`}>{verdict.text}</span>
      </div>
      <p className="mb-3 text-sm text-plum-500">
        The last seven days at a glance — uptime, stability, backup success, and who actually played.
        {card.restartLimits > 0 && <span className="font-medium text-amber-600"> The restart limit was hit {card.restartLimits}× this week — check the crash analyzer.</span>}
      </p>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-candy-100 px-3 py-2">
            <div className="text-[10.5px] font-medium uppercase tracking-wider text-plum-400">{s.label}</div>
            <div className="text-[15px] font-semibold text-plum-800">{s.value}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Btn variant="subtle" loading={busy} onClick={() => void send()}>
          <Send size={13} /> Send to webhook
        </Btn>
        {notice && <span className={`text-xs ${notice.ok ? "text-emerald-600" : "text-red-500"}`}>{notice.text}</span>}
      </div>
    </section>
  );
}

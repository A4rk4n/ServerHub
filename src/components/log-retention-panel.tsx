"use client";

import { Archive, Scissors } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Btn, Spin, Toggle, inputCls } from "./ui";

type Config = { enabled: boolean; retentionDays: number; archive: boolean; archiveKeep: number };
type Status = { lastSweepAt: string | null; lastResult: { prunedLines: number; archivedFiles: number; sweptAt: string } | null };

export function LogRetentionPanel() {
  const [config, setConfig] = useState<Config | null>(null);
  const [status, setStatus] = useState<Status>({ lastSweepAt: null, lastResult: null });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/log-retention", { cache: "no-store" });
      const j = await r.json();
      setConfig(j.config);
      setStatus(j.status ?? { lastSweepAt: null, lastResult: null });
    } catch {
      setConfig({ enabled: true, retentionDays: 30, archive: true, archiveKeep: 30 });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(t);
  }, [notice]);

  if (!config) return <Spin label="Loading log retention…" />;

  async function save(next: Config) {
    setBusy("save");
    try {
      const r = await fetch("/api/log-retention", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const j = await r.json();
      if (r.ok) {
        setConfig(j.config);
        setNotice({ text: "Retention settings saved", ok: true });
      } else {
        setNotice({ text: j.error ?? "Save failed", ok: false });
      }
    } finally {
      setBusy(null);
    }
  }

  async function sweepNow() {
    setBusy("sweep");
    try {
      const r = await fetch("/api/log-retention", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sweep-now" }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setStatus(j.status ?? status);
        setNotice({
          text: j.prunedLines > 0 ? `Pruned ${j.prunedLines} line${j.prunedLines === 1 ? "" : "s"}${j.archivedFiles ? ` (${j.archivedFiles} archive${j.archivedFiles === 1 ? "" : "s"})` : ""} ✓` : "Nothing old enough to prune ✓",
          ok: true,
        });
      } else {
        setNotice({ text: j.error ?? "Sweep failed", ok: false });
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel p-5">
      <div className="mb-1 flex items-center gap-2">
        <Scissors size={15} className="text-plum-500" />
        <h3 className="font-display text-[13.5px] font-semibold text-plum-900">Console log retention</h3>
      </div>
      <p className="mb-3 text-[12px] text-plum-500">
        Console lines older than the window are pruned hourly to keep searches fast. With archiving on, pruned lines are gzipped into the
        app-data <span className="font-mono">log-archive</span> folder first — nothing is lost by default.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Toggle checked={config.enabled} onChange={(v) => void save({ ...config, enabled: v })} />
          <span className="text-[12px] text-plum-600">{config.enabled ? "Enabled" : "Disabled"}</span>
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-plum-600">
          keep
          <input
            type="number"
            min={1}
            max={365}
            value={config.retentionDays}
            onChange={(e) => setConfig({ ...config, retentionDays: Math.round(Number(e.target.value)) || 30 })}
            onBlur={() => void save(config)}
            className={`${inputCls} w-20 font-mono`}
          />
          days
        </label>
        <div className="flex items-center gap-2">
          <Toggle checked={config.archive} onChange={(v) => void save({ ...config, archive: v })} />
          <span className="flex items-center gap-1 text-[12px] text-plum-600"><Archive size={12} /> archive before pruning</span>
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-plum-600">
          max
          <input
            type="number"
            min={1}
            max={365}
            value={config.archiveKeep}
            onChange={(e) => setConfig({ ...config, archiveKeep: Math.round(Number(e.target.value)) || 30 })}
            onBlur={() => void save(config)}
            className={`${inputCls} w-20 font-mono`}
            disabled={!config.archive}
          />
          archives per server
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Btn variant="subtle" onClick={() => void sweepNow()} loading={busy === "sweep"}>
          <Scissors size={13} /> Sweep now
        </Btn>
        <span className="text-[11px] text-plum-400">
          {status.lastResult
            ? <>Last sweep {new Date(status.lastResult.sweptAt).toLocaleString()}: {status.lastResult.prunedLines} pruned, {status.lastResult.archivedFiles} archived</>
            : "No sweep yet this session."}
        </span>
        {notice && <span className={`text-[12px] font-semibold ${notice.ok ? "text-emerald-600" : "text-rose-500"}`}>{notice.text}</span>}
      </div>
    </div>
  );
}

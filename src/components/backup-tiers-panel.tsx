"use client";

import { Layers } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Btn, Spin, Toggle, inputCls } from "./ui";

type Tiers = { enabled: boolean; daily: number; weekly: number };

export function BackupTiersPanel({ serverId, accent }: { serverId: number; accent: string }) {
  const [tiers, setTiers] = useState<Tiers | null>(null);
  const [wouldPrune, setWouldPrune] = useState(0);
  const [total, setTotal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/servers/${serverId}/backup-tiers`, { cache: "no-store" });
      const j = await r.json();
      if (j.tiers) {
        setTiers(j.tiers);
        setWouldPrune(j.wouldPrune ?? 0);
        setTotal(j.total ?? 0);
      }
    } catch {
      setTiers({ enabled: false, daily: 7, weekly: 4 });
    }
  }, [serverId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(t);
  }, [notice]);

  if (!tiers) return <Spin label="Loading tiered retention…" />;

  async function save() {
    setSaving(true);
    try {
      const r = await fetch(`/api/servers/${serverId}/backup-tiers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tiers),
      });
      const j = await r.json();
      if (r.ok) {
        setTiers(j.tiers);
        setWouldPrune(j.wouldPrune ?? 0);
        setTotal(j.total ?? 0);
        setNotice({ text: j.tiers.enabled ? "Tiered retention saved ✓" : "Tiered retention off — flat limits apply", ok: true });
      } else {
        setNotice({ text: j.error ?? "Save failed", ok: false });
      }
    } catch {
      setNotice({ text: "Save failed", ok: false });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel p-5">
      <div className="mb-1 flex items-center gap-2">
        <Layers size={15} style={{ color: accent }} />
        <p className="text-sm font-semibold text-plum-800">Tiered backup retention</p>
      </div>
      <p className="mb-3 text-xs text-plum-500">
        Keep the newest backup of each of the last N days plus the newest of each of the last N weeks — long-term history
        without unbounded storage. While enabled, this replaces the simple count/age limits. The update safety backup is
        never pruned. Pruning runs after each backup or on a scheduled prune task.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs font-medium text-plum-600">
          <Toggle checked={tiers.enabled} onChange={(v) => setTiers({ ...tiers, enabled: v })} accent={accent} />
          Use tiers
        </label>
        <label className="flex items-center gap-2 text-xs font-medium text-plum-600">
          Daily
          <input
            type="number"
            min={0}
            max={30}
            value={tiers.daily}
            onChange={(e) => setTiers({ ...tiers, daily: Math.max(0, Math.min(30, Math.round(Number(e.target.value) || 0))) })}
            className={`${inputCls} !w-20`}
          />
        </label>
        <label className="flex items-center gap-2 text-xs font-medium text-plum-600">
          Weekly
          <input
            type="number"
            min={0}
            max={52}
            value={tiers.weekly}
            onChange={(e) => setTiers({ ...tiers, weekly: Math.max(0, Math.min(52, Math.round(Number(e.target.value) || 0))) })}
            className={`${inputCls} !w-20`}
          />
        </label>
        <Btn variant="subtle" loading={saving} onClick={save}>
          Save retention
        </Btn>
        {notice && (
          <span className={`text-[12px] font-semibold ${notice.ok ? "text-emerald-600" : "text-rose-500"}`}>{notice.text}</span>
        )}
      </div>
      {tiers.enabled && total > 0 && (
        <p className="mt-2 text-[11px] text-plum-400">
          Right now this policy keeps <span className="font-semibold text-plum-600">{total - wouldPrune}</span> of {total} backups
          {wouldPrune > 0 ? <> and would prune <span className="font-semibold text-rose-500">{wouldPrune}</span> on the next run</> : ""}.
        </p>
      )}
    </div>
  );
}

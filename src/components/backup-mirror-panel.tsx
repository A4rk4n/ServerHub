"use client";

import { FolderSync, HardDriveDownload, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Btn, Field, Spin, Toggle, inputCls } from "./ui";

type MirrorConfig = { enabled: boolean; directory: string };
type MirrorHealth = { eligible: number; mirrored: number; pending: number; failed: number; lastError: string | null };

export function BackupMirrorPanel() {
  const [config, setConfig] = useState<MirrorConfig | null>(null);
  const [health, setHealth] = useState<MirrorHealth | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/backup-mirror", { cache: "no-store" });
        const j = await r.json();
        if (j.config) setConfig(j.config);
        if (j.health) setHealth(j.health);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  if (!config) return <Spin label="Loading backup mirror…" />;

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      const r = await fetch("/api/backup-mirror", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const j = await r.json();
      if (r.ok) {
        setConfig(j.config);
        setHealth(j.health);
        setNotice({ text: "Mirror settings saved", ok: true });
      } else {
        setNotice({ text: j.error ?? "Save failed", ok: false });
      }
    } finally {
      setSaving(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const r = await fetch("/api/backup-mirror", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.reason) setNotice({ text: j.reason, ok: false });
      else setNotice({ text: `Sync finished: ${j.copied ?? 0} copied · ${j.upToDate ?? 0} already verified · ${j.removedStale ?? 0} stale removed${j.failed ? ` · ${j.failed} FAILED` : ""}`, ok: !j.failed });
      const s = await fetch("/api/backup-mirror", { cache: "no-store" }).then((res) => res.json()).catch(() => null);
      if (s?.health) setHealth(s.health);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="panel p-5">
      <h3 className="font-display mb-1 flex items-center gap-2 text-[15px] font-bold text-plum-900">
        <HardDriveDownload size={16} className="text-candy-500" /> Backup mirror
      </h3>
      <p className="mb-4 text-[12px] text-plum-500">
        Keep a checksum-verified second copy of every completed backup on another disk, NAS share, or synced folder. Copies are
        re-hashed after writing — a copy only counts when its SHA-256 matches the original. Mirror health is included in the
        activity digest, and failures alert through the backup notification group.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2.5 rounded-xl border border-candy-200 px-3 py-2.5">
          <Toggle checked={config.enabled} onChange={(v) => setConfig({ ...config, enabled: v })} />
          <span className="text-[12.5px] font-semibold text-plum-700">{config.enabled ? "Enabled" : "Disabled"}</span>
        </div>
        <div className="min-w-[280px] flex-1">
          <Field label="Mirror directory" hint="Absolute path outside the Server Hub data directory">
            <input
              value={config.directory}
              onChange={(e) => setConfig({ ...config, directory: e.target.value })}
              placeholder="D:\\Backups\\ServerHub or /mnt/nas/serverhub"
              className={inputCls}
              spellCheck={false}
            />
          </Field>
        </div>
        <Btn onClick={() => void save()} disabled={saving}>
          {saving ? <RefreshCw size={14} className="animate-spin" /> : null} Save
        </Btn>
        <Btn onClick={() => void syncNow()} disabled={syncing || !config.enabled}>
          {syncing ? <RefreshCw size={14} className="animate-spin" /> : <FolderSync size={14} />} Sync now
        </Btn>
      </div>
      {health ? (
        <div className="mt-4 flex flex-wrap gap-2 text-[12px]">
          <span className="rounded-lg border border-candy-200 px-2.5 py-1 font-semibold text-plum-700">{health.eligible} backups eligible</span>
          <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">{health.mirrored} mirrored ✓</span>
          {health.pending > 0 ? <span className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 font-semibold text-amber-700">{health.pending} pending</span> : null}
          {health.failed > 0 ? <span className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 font-semibold text-rose-700">{health.failed} failed</span> : null}
        </div>
      ) : null}
      {health?.lastError ? <p className="mt-2 text-[12px] text-rose-600">Last error: {health.lastError}</p> : null}
      {notice ? <p className={`mt-3 text-[12px] font-semibold ${notice.ok ? "text-emerald-600" : "text-rose-600"}`}>{notice.text}</p> : null}
    </div>
  );
}

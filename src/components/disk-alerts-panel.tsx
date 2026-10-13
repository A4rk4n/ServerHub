"use client";

import { HardDrive, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Btn, Spin, Toggle, inputCls } from "./ui";

type Config = { enabled: boolean; minFreeMb: number; cooldownMin: number };
type Status = { freeMb: number | null; lastAlertAt: string | null };

function fmtMb(mb: number) {
  if (mb >= 10240) return `${(mb / 1024).toFixed(0)} GB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

export function DiskAlertsPanel() {
  const [config, setConfig] = useState<Config | null>(null);
  const [status, setStatus] = useState<Status>({ freeMb: null, lastAlertAt: null });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/disk-alerts", { cache: "no-store" });
      const j = await r.json();
      setConfig(j.config);
      setStatus(j.status ?? { freeMb: null, lastAlertAt: null });
    } catch {
      setConfig({ enabled: true, minFreeMb: 2048, cooldownMin: 360 });
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

  if (!config) return <Spin label="Loading disk alerts…" />;

  async function save(next: Config) {
    setBusy("save");
    try {
      const r = await fetch("/api/disk-alerts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const j = await r.json();
      if (r.ok) {
        setConfig(j.config);
        setNotice({ text: "Disk alert settings saved", ok: true });
      } else {
        setNotice({ text: j.error ?? "Save failed", ok: false });
      }
    } finally {
      setBusy(null);
    }
  }

  async function checkNow() {
    setBusy("check");
    try {
      const r = await fetch("/api/disk-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check-now" }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setStatus(j.status ?? { freeMb: j.freeMb ?? null, lastAlertAt: null });
        setNotice(
          j.breached
            ? { text: `Low space${j.alerted ? " — alert sent" : " (alert on cooldown)"}`, ok: false }
            : { text: `Checked: ${j.freeMb != null ? fmtMb(j.freeMb) : "?"} free ✓`, ok: true }
        );
      } else {
        setNotice({ text: j.error ?? "Check failed", ok: false });
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel p-5">
      <div className="mb-1 flex items-center gap-2">
        <HardDrive size={15} className="text-plum-500" />
        <h3 className="font-display text-[13.5px] font-semibold text-plum-900">Disk space alerts</h3>
      </div>
      <p className="mb-3 text-[12px] text-plum-500">
        The panel volume is checked every 5 minutes — when free space drops below the threshold, the webhook fires and an entry lands in
        the activity feed. Nothing is ever deleted automatically.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Toggle checked={config.enabled} onChange={(v) => void save({ ...config, enabled: v })} />
          <span className="text-[12px] text-plum-600">{config.enabled ? "Enabled" : "Disabled"}</span>
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-plum-600">
          alert below
          <input
            type="number"
            min={128}
            max={1048576}
            value={config.minFreeMb}
            onChange={(e) => setConfig({ ...config, minFreeMb: Math.round(Number(e.target.value)) || 2048 })}
            onBlur={() => void save(config)}
            className={`${inputCls} w-28 font-mono`}
          />
          MB free
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-plum-600">
          repeat every
          <input
            type="number"
            min={15}
            max={10080}
            value={config.cooldownMin}
            onChange={(e) => setConfig({ ...config, cooldownMin: Math.round(Number(e.target.value)) || 360 })}
            onBlur={() => void save(config)}
            className={`${inputCls} w-24 font-mono`}
          />
          minutes
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Btn variant="subtle" onClick={() => void checkNow()} loading={busy === "check"}>
          <RefreshCw size={13} /> Check now
        </Btn>
        <span className="text-[11px] text-plum-400">
          {status.freeMb != null && <>Free now: <span className="font-semibold text-plum-600">{fmtMb(status.freeMb)}</span></>}
          {status.lastAlertAt && <> · last alert {new Date(status.lastAlertAt).toLocaleString()}</>}
        </span>
        {notice && <span className={`text-[12px] font-semibold ${notice.ok ? "text-emerald-600" : "text-rose-500"}`}>{notice.text}</span>}
      </div>
    </div>
  );
}

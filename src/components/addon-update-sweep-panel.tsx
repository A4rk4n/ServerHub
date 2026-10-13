"use client";

import { Blocks } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Btn, Spin, Toggle, inputCls } from "./ui";

type Config = { enabled: boolean; intervalHours: number };
type Status = {
  lastRunAt: string | null;
  lastResult: { checkedServers: number; checkedAddons: number; updatesFound: number; sweptAt: string } | null;
};

export function AddonUpdateSweepPanel() {
  const [config, setConfig] = useState<Config | null>(null);
  const [status, setStatus] = useState<Status>({ lastRunAt: null, lastResult: null });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/addon-update-sweep", { cache: "no-store" });
      const j = await r.json();
      setConfig(j.config);
      setStatus(j.status ?? { lastRunAt: null, lastResult: null });
    } catch {
      setConfig({ enabled: false, intervalHours: 24 });
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

  if (!config) return <Spin label="Loading mod update checks…" />;

  async function save(next: Config) {
    setBusy("save");
    try {
      const r = await fetch("/api/addon-update-sweep", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const j = await r.json();
      if (r.ok) {
        setConfig(j.config);
        setNotice({ text: "Mod update check settings saved", ok: true });
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
      const r = await fetch("/api/addon-update-sweep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sweep-now" }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setStatus(j.status ?? status);
        setNotice({
          text:
            j.checkedServers > 0
              ? `Checked ${j.checkedAddons} mod${j.checkedAddons === 1 ? "" : "s"} across ${j.checkedServers} server${j.checkedServers === 1 ? "" : "s"} — ${j.updatesFound > 0 ? `${j.updatesFound} update${j.updatesFound === 1 ? "" : "s"} available` : "all up to date"} ✓`
              : "No servers with Modrinth mods to check ✓",
          ok: true,
        });
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
        <Blocks size={15} className="text-plum-500" />
        <h3 className="font-display text-[13.5px] font-semibold text-plum-900">Scheduled mod update checks</h3>
      </div>
      <p className="mb-3 text-[12px] text-plum-500">
        Re-checks every server&apos;s Modrinth mods for newer compatible releases on a schedule and logs a notification when
        something new appears — only when the set of available updates changes, never a daily repeat. Updates are still applied
        from each server&apos;s Addons tab.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Toggle checked={config.enabled} onChange={(v) => void save({ ...config, enabled: v })} />
          <span className="text-[12px] text-plum-600">{config.enabled ? "Enabled" : "Disabled"}</span>
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-plum-600">
          every
          <input
            type="number"
            min={6}
            max={168}
            value={config.intervalHours}
            onChange={(e) => setConfig({ ...config, intervalHours: Math.round(Number(e.target.value)) || 24 })}
            onBlur={() => void save(config)}
            className={`${inputCls} w-20 font-mono`}
          />
          hours
        </label>
        <Btn variant="subtle" loading={busy === "sweep"} onClick={() => void sweepNow()}>
          Check fleet now
        </Btn>
      </div>
      <div className="mt-2 text-[11.5px] text-plum-500">
        {status.lastResult
          ? `Last check ${new Date(status.lastResult.sweptAt).toLocaleString()}: ${status.lastResult.checkedAddons} mod${status.lastResult.checkedAddons === 1 ? "" : "s"} on ${status.lastResult.checkedServers} server${status.lastResult.checkedServers === 1 ? "" : "s"}, ${status.lastResult.updatesFound} update${status.lastResult.updatesFound === 1 ? "" : "s"} available.`
          : "No fleet-wide check has run yet."}
        {notice ? <span className={notice.ok ? " text-emerald-600" : " text-red-600"}> {notice.text}</span> : null}
      </div>
    </div>
  );
}

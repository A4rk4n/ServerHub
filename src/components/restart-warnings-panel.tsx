"use client";

import { AlertTriangle, Megaphone, OctagonX, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Btn, Spin, Toggle, inputCls } from "./ui";

type Config = { enabled: boolean; intervalsSec: number[]; template: string };
type Countdown = { active: boolean; action?: string; endsAt?: string; label?: string };

export function RestartWarningsPanel({ serverId, accent }: { serverId: number; accent: string }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [supported, setSupported] = useState(true);
  const [countdown, setCountdown] = useState<Countdown>({ active: false });
  const [intervalsText, setIntervalsText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/servers/${serverId}/restart-warnings`, { cache: "no-store" });
      const j = await r.json();
      setConfig(j.config);
      setSupported(Boolean(j.supported));
      setCountdown(j.countdown ?? { active: false });
      setIntervalsText((j.config?.intervalsSec ?? []).join(", "));
    } catch {
      setConfig({ enabled: true, intervalsSec: [600, 300, 60, 30], template: "" });
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

  if (!config) return <Spin label="Loading restart warnings…" />;

  async function save() {
    if (!config) return;
    setBusy("save");
    try {
      const intervalsSec = intervalsText
        .split(/[,\s]+/)
        .map((piece) => Number(piece))
        .filter((value) => Number.isInteger(value) && value > 0);
      const r = await fetch(`/api/servers/${serverId}/restart-warnings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, intervalsSec }),
      });
      const j = await r.json();
      if (r.ok) {
        setConfig(j.config);
        setSupported(Boolean(j.supported));
        setIntervalsText(j.config.intervalsSec.join(", "));
        setNotice({ text: "Warning settings saved", ok: true });
      } else {
        setNotice({ text: j.error ?? "Save failed", ok: false });
      }
    } finally {
      setBusy(null);
    }
  }

  async function post(action: "test" | "cancel") {
    setBusy(action);
    try {
      const r = await fetch(`/api/servers/${serverId}/restart-warnings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = await r.json().catch(() => ({}));
      setNotice(
        r.ok
          ? { text: action === "test" ? "Test broadcast sent ✓" : "Countdown cancelled", ok: true }
          : { text: j.error ?? "Request failed", ok: false }
      );
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel p-5">
      <div className="mb-1 flex items-center gap-2">
        <Megaphone size={15} style={{ color: accent }} />
        <h3 className="font-display text-[13.5px] font-semibold text-plum-900">Restart countdown warnings</h3>
      </div>
      <p className="mb-3 text-[12px] text-plum-500">
        Scheduled stops and restarts warn players in-game first, then act when the countdown reaches zero. The longest interval sets the
        total countdown length.
      </p>
      {countdown.active && (
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
          <AlertTriangle size={13} />
          <span>
            Countdown running (<span className="font-semibold">{countdown.action}</span> by “{countdown.label}”) — fires at{" "}
            {countdown.endsAt ? new Date(countdown.endsAt).toLocaleTimeString() : "soon"}.
          </span>
          <Btn size="sm" variant="subtle" onClick={() => void post("cancel")} loading={busy === "cancel"}>
            <OctagonX size={12} /> Cancel
          </Btn>
        </div>
      )}
      {!supported && (
        <div className="mb-3 rounded-xl bg-candy-50 px-3 py-2 text-[12px] text-plum-500">
          This game has no built-in broadcast command — set a custom template below (it must contain <span className="font-mono">{"{message}"}</span>)
          or scheduled power actions will simply run immediately.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Toggle checked={config.enabled} onChange={(v) => setConfig({ ...config, enabled: v })} />
          <span className="text-[12px] text-plum-600">{config.enabled ? "Enabled" : "Disabled"}</span>
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-plum-600">
          warn at
          <input
            value={intervalsText}
            onChange={(e) => setIntervalsText(e.target.value)}
            placeholder="600, 300, 60, 30"
            className={`${inputCls} w-44 font-mono`}
            spellCheck={false}
          />
          seconds before
        </label>
        <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-plum-600">
          template
          <input
            value={config.template}
            onChange={(e) => setConfig({ ...config, template: e.target.value })}
            placeholder={'optional, e.g. say {message}'}
            className={`${inputCls} min-w-0 flex-1 font-mono`}
            spellCheck={false}
          />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Btn variant="primary" accent={accent} onClick={save} loading={busy === "save"}>
          Save
        </Btn>
        <Btn variant="subtle" onClick={() => void post("test")} loading={busy === "test"}>
          <Send size={13} /> Test broadcast
        </Btn>
        {notice && <span className={`text-[12px] font-semibold ${notice.ok ? "text-emerald-600" : "text-rose-500"}`}>{notice.text}</span>}
      </div>
    </div>
  );
}

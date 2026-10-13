"use client";

import { BellRing, CalendarClock, Check, History, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { timeAgo } from "@/lib/format";
import { Btn, Field, Spin, Toggle, inputCls } from "./ui";

type Digest = { enabled: boolean; cadence: "daily" | "weekly"; hour: number };
type Config = { url: string; events: { status: boolean; crash: boolean; backup: boolean }; digest: Digest; format?: "auto" | "discord" | "slack" | "json" };
const FORMAT_OPTIONS = [
  { value: "auto", label: "Auto", hint: "detect from the URL" },
  { value: "discord", label: "Discord", hint: "Discord-style content" },
  { value: "slack", label: "Slack", hint: "Slack text payload" },
  { value: "json", label: "JSON", hint: "generic machine-readable" },
] as const;
type Delivery = { at: string; kind: string; server: string; ok: boolean; status: number; error: string; durationMs: number; target: string };

export function NotificationsPanel() {
  const [config, setConfig] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [digesting, setDigesting] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch("/api/notifications/history", { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j.deliveries)) setDeliveries(j.deliveries);
    } catch {}
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/notifications", { cache: "no-store" });
        const j = await r.json();
        if (j.config) setConfig(j.config);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(t);
  }, [notice]);

  if (!config) return <Spin label="Loading notifications…" />;

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      const r = await fetch("/api/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const j = await r.json();
      setNotice(r.ok ? { text: "Notification settings saved", ok: true } : { text: j.error ?? "Save failed", ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function sendDigestNow() {
    setDigesting(true);
    try {
      const r = await fetch("/api/notifications/digest", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      setNotice(r.ok ? { text: "Activity digest delivered ✓", ok: true } : { text: j.reason ?? "Digest failed", ok: false });
    } finally {
      setDigesting(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      const r = await fetch("/api/notifications/test", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      setNotice(r.ok ? { text: "Test notification delivered ✓", ok: true } : { text: j.error ?? "Test failed", ok: false });
      void loadHistory();
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="panel p-5">
      <h3 className="font-display mb-1 flex items-center gap-2 text-[15px] font-bold text-plum-900">
        <BellRing size={16} className="text-candy-500" /> Notifications
      </h3>
      <p className="mb-4 text-[12px] text-plum-500">
        Send fleet events to a webhook — Discord and Slack URLs are formatted automatically, or pick a payload format below. The URL is stored locally with restricted
        permissions and is never included in support bundles.
      </p>
      <Field label="Webhook URL">
        <input
          value={config.url}
          onChange={(e) => setConfig({ ...config, url: e.target.value })}
          placeholder="https://discord.com/api/webhooks/… (empty = disabled)"
          className={inputCls}
          spellCheck={false}
        />
      </Field>
      <div className="mt-3">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-plum-500">Payload format</p>
        <div className="flex flex-wrap gap-1.5">
          {FORMAT_OPTIONS.map((option) => {
            const active = (config.format ?? "auto") === option.value;
            return (
              <button
                key={option.value}
                type="button"
                title={option.hint}
                onClick={() => setConfig({ ...config, format: option.value })}
                className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition ${active ? "bg-candy-500 text-white" : "bg-candy-50 text-plum-500 hover:text-plum-700"}`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-plum-400">
          Auto detects Discord and Slack from the URL; pick a format explicitly for compatible endpoints on other hosts (Mattermost, proxies).
        </p>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {(
          [
            ["crash", "Crashes & watchdog"],
            ["status", "Online / offline"],
            ["backup", "Backup outcomes"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="flex items-center gap-2.5 rounded-xl border border-candy-200 px-3 py-2.5">
            <Toggle checked={config.events[key]} onChange={(v) => setConfig({ ...config, events: { ...config.events, [key]: v } })} />
            <span className="text-[12.5px] font-semibold text-plum-700">{label}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl border border-candy-200 p-3.5">
        <div className="mb-2 flex items-center gap-2">
          <CalendarClock size={14} className="text-candy-500" />
          <span className="text-[12.5px] font-semibold text-plum-800">Activity digest</span>
          <span className="text-[11px] text-plum-400">uptime, players, playtime, backups, crashes, guardrails, pending updates</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Toggle checked={config.digest.enabled} onChange={(v) => setConfig({ ...config, digest: { ...config.digest, enabled: v } })} />
            <span className="text-[12px] text-plum-600">{config.digest.enabled ? "Enabled" : "Disabled"}</span>
          </div>
          <select
            value={config.digest.cadence}
            onChange={(e) => setConfig({ ...config, digest: { ...config.digest, cadence: e.target.value as Digest["cadence"] } })}
            className={inputCls + " w-auto"}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly (Mondays)</option>
          </select>
          <label className="flex items-center gap-1.5 text-[12px] text-plum-600">
            after
            <select
              value={config.digest.hour}
              onChange={(e) => setConfig({ ...config, digest: { ...config.digest, hour: Number(e.target.value) } })}
              className={inputCls + " w-auto"}
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>
              ))}
            </select>
            local time
          </label>
          <Btn variant="subtle" onClick={sendDigestNow} loading={digesting} disabled={!config.url}>
            <Send size={13} /> Send digest now
          </Btn>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Btn variant="primary" onClick={save} loading={saving}>
          <Check size={15} /> Save
        </Btn>
        <Btn variant="subtle" onClick={sendTest} loading={testing} disabled={!config.url}>
          <Send size={14} /> Send test
        </Btn>
        {notice && (
          <span className={`text-[12px] font-semibold ${notice.ok ? "text-emerald-600" : "text-rose-500"}`}>{notice.text}</span>
        )}
      </div>
      <div className="mt-5 border-t border-candy-100 pt-4">
        <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-plum-500">
          <History size={12} /> Recent deliveries
        </p>
        {!deliveries || deliveries.length === 0 ? (
          <p className="text-xs text-plum-400">No webhook deliveries recorded yet — muted events are not attempts.</p>
        ) : (
          <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {deliveries.map((d, index) => (
              <div key={`${d.at}-${index}`} className="flex items-center gap-2 rounded-lg border border-candy-100 px-2.5 py-1.5 text-xs">
                <span className={`inline-flex shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold ${d.ok ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"}`}>
                  {d.status > 0 ? d.status : "ERR"}
                </span>
                <span className="font-semibold text-plum-800">{d.kind}</span>
                <span className="truncate text-plum-500">{d.server}</span>
                {!d.ok && d.error && <span className="truncate text-red-400" title={d.error}>{d.error}</span>}
                <span className="ml-auto shrink-0 text-plum-400">{d.durationMs}ms · {d.target} · {timeAgo(d.at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

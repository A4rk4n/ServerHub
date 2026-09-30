"use client";

import { BellRing, Check, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Btn, Field, Spin, Toggle, inputCls } from "./ui";

type Config = { url: string; events: { status: boolean; crash: boolean; backup: boolean } };

export function NotificationsPanel() {
  const [config, setConfig] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

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

  async function sendTest() {
    setTesting(true);
    try {
      const r = await fetch("/api/notifications/test", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      setNotice(r.ok ? { text: "Test notification delivered ✓", ok: true } : { text: j.error ?? "Test failed", ok: false });
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
        Send fleet events to a webhook — Discord webhook URLs are formatted automatically. The URL is stored locally with restricted
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
    </div>
  );
}

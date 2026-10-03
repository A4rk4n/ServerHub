"use client";

import { Check, Copy, ExternalLink, Globe2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Btn, Field, Spin, Toggle, inputCls } from "./ui";

type Config = { enabled: boolean; token: string; title: string };

export function StatusPagePanel() {
  const [config, setConfig] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/status-page", { cache: "no-store" });
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

  if (!config) return <Spin label="Loading status page…" />;

  const shareUrl = config.token ? `${typeof window !== "undefined" ? window.location.origin : ""}/status?token=${config.token}` : "";

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      const r = await fetch("/api/status-page", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: config.enabled, title: config.title }),
      });
      const j = await r.json();
      if (r.ok) {
        setConfig(j.config);
        setNotice({ text: "Status page settings saved", ok: true });
      } else {
        setNotice({ text: j.error ?? "Save failed", ok: false });
      }
    } finally {
      setSaving(false);
    }
  }

  async function regenerate() {
    setRotating(true);
    try {
      const r = await fetch("/api/status-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "regenerate" }),
      });
      const j = await r.json();
      if (r.ok) {
        setConfig(j.config);
        setNotice({ text: "New link generated — the old one stopped working", ok: true });
      }
    } finally {
      setRotating(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  return (
    <div className="panel p-5">
      <h3 className="font-display mb-1 flex items-center gap-2 text-[15px] font-bold text-plum-900">
        <Globe2 size={16} className="text-candy-500" /> Public status page
      </h3>
      <p className="mb-4 text-[12px] text-plum-500">
        A read-only page for your players: which servers are up, how many are playing, and what version runs where. Guarded by a
        secret link token (never by your PIN) and built from a whitelist — names, games, versions, and player counts only.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2.5 rounded-xl border border-candy-200 px-3 py-2.5">
          <Toggle checked={config.enabled} onChange={(v) => setConfig({ ...config, enabled: v })} />
          <span className="text-[12.5px] font-semibold text-plum-700">{config.enabled ? "Enabled" : "Disabled"}</span>
        </div>
        <div className="min-w-[220px] flex-1">
          <Field label="Page title">
            <input
              value={config.title}
              onChange={(e) => setConfig({ ...config, title: e.target.value })}
              className={inputCls}
              maxLength={60}
            />
          </Field>
        </div>
        <Btn onClick={() => void save()} disabled={saving}>
          {saving ? <RefreshCw size={14} className="animate-spin" /> : null} Save
        </Btn>
      </div>
      {config.enabled && config.token ? (
        <div className="mt-4 rounded-xl border border-candy-200 p-3.5">
          <div className="mb-2 text-[12.5px] font-semibold text-plum-800">Share link</div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-plum-50 px-2.5 py-1.5 font-mono text-[11.5px] text-plum-700">{shareUrl}</code>
            <Btn onClick={() => void copyLink()}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}</Btn>
            <a href={shareUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[12px] font-semibold text-candy-600 hover:underline">
              <ExternalLink size={13} /> Open
            </a>
            <Btn onClick={() => void regenerate()} disabled={rotating}>
              {rotating ? <RefreshCw size={14} className="animate-spin" /> : null} New link
            </Btn>
          </div>
          <p className="mt-2 text-[11.5px] text-plum-400">
            Anyone with this link can see the page. Generate a new link to revoke the old one instantly.
          </p>
        </div>
      ) : null}
      {notice ? <p className={`mt-3 text-[12px] font-semibold ${notice.ok ? "text-emerald-600" : "text-rose-600"}`}>{notice.text}</p> : null}
    </div>
  );
}

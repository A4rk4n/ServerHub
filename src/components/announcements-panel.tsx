"use client";

import { Megaphone, Plus, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Btn, Spin, Toggle, inputCls } from "./ui";

type Config = { enabled: boolean; intervalMin: number; order: "sequential" | "random"; template: string; messages: string[] };
type AnnouncerState = { lastSentAt: string | null };

export function AnnouncementsPanel({ serverId, accent }: { serverId: number; accent: string }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [supported, setSupported] = useState(true);
  const [sentState, setSentState] = useState<AnnouncerState>({ lastSentAt: null });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/servers/${serverId}/announcements`, { cache: "no-store" });
      const j = await r.json();
      setConfig(j.config);
      setSupported(Boolean(j.supported));
      setSentState(j.state ?? { lastSentAt: null });
    } catch {
      setConfig({ enabled: false, intervalMin: 30, order: "sequential", template: "", messages: [] });
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

  if (!config) return <Spin label="Loading announcements…" />;

  async function save(next: Config) {
    setBusy("save");
    try {
      const r = await fetch(`/api/servers/${serverId}/announcements`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const j = await r.json();
      if (r.ok) {
        setConfig(j.config);
        setSupported(Boolean(j.supported));
        setNotice({ text: "Announcements saved", ok: true });
      } else {
        setNotice({ text: j.error ?? "Save failed", ok: false });
      }
    } finally {
      setBusy(null);
    }
  }

  async function sendNow() {
    setBusy("send");
    try {
      const r = await fetch(`/api/servers/${serverId}/announcements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send-now" }),
      });
      const j = await r.json().catch(() => ({}));
      setNotice(r.ok ? { text: `Broadcast sent: “${j.message}”`, ok: true } : { text: j.error ?? "Broadcast failed", ok: false });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  function addMessage() {
    const text = draft.trim();
    if (!config || !text) return;
    setDraft("");
    void save({ ...config, messages: [...config.messages, text] });
  }

  function removeMessage(index: number) {
    if (!config) return;
    void save({ ...config, messages: config.messages.filter((_, i) => i !== index) });
  }

  return (
    <div className="panel p-5">
      <div className="mb-1 flex items-center gap-2">
        <Megaphone size={15} style={{ color: accent }} />
        <h3 className="font-display text-[13.5px] font-semibold text-plum-900">Scheduled announcements</h3>
      </div>
      <p className="mb-3 text-[12px] text-plum-500">
        Rotate in-game broadcasts while the server is online — rules reminders, Discord invites, backup notices. The first message goes out
        one full interval after the server starts.
      </p>
      {!supported && (
        <div className="mb-3 rounded-xl bg-candy-50 px-3 py-2 text-[12px] text-plum-500">
          This game has no built-in broadcast command — set a custom template below (it must contain <span className="font-mono">{"{message}"}</span>)
          or announcements will not be delivered.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Toggle checked={config.enabled} onChange={(v) => void save({ ...config, enabled: v })} />
          <span className="text-[12px] text-plum-600">{config.enabled ? "Enabled" : "Disabled"}</span>
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-plum-600">
          every
          <input
            type="number"
            min={1}
            max={1440}
            value={config.intervalMin}
            onChange={(e) => setConfig({ ...config, intervalMin: Math.round(Number(e.target.value)) || 30 })}
            onBlur={() => void save(config)}
            className={`${inputCls} w-20 font-mono`}
          />
          minutes
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-plum-600">
          order
          <select
            value={config.order}
            onChange={(e) => void save({ ...config, order: e.target.value === "random" ? "random" : "sequential" })}
            className={`${inputCls} w-32`}
          >
            <option value="sequential">Sequential</option>
            <option value="random">Random</option>
          </select>
        </label>
        <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-plum-600">
          template
          <input
            value={config.template}
            onChange={(e) => setConfig({ ...config, template: e.target.value })}
            onBlur={() => void save(config)}
            placeholder={'optional, e.g. say {message}'}
            className={`${inputCls} min-w-0 flex-1 font-mono`}
            spellCheck={false}
          />
        </label>
      </div>
      <div className="mt-3 space-y-1.5">
        {config.messages.length === 0 && (
          <p className="rounded-xl bg-candy-50 px-3 py-2 text-[12px] text-plum-400">No messages yet — add one below to start the rotation.</p>
        )}
        {config.messages.map((message, index) => (
          <div key={`${index}-${message}`} className="flex items-center gap-2 rounded-xl border border-candy-100 px-3 py-1.5">
            <span className="w-5 text-right font-mono text-[11px] text-plum-400">{index + 1}.</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-plum-700">{message}</span>
            <button
              onClick={() => removeMessage(index)}
              className="rounded-lg p-1 text-plum-300 transition hover:bg-rose-50 hover:text-rose-500"
              aria-label={`Remove announcement ${index + 1}`}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addMessage(); }}
          placeholder="New announcement message (max 200 chars)…"
          maxLength={200}
          className={`${inputCls} min-w-0 flex-1`}
        />
        <Btn variant="primary" accent={accent} onClick={addMessage} loading={busy === "save"}>
          <Plus size={13} /> Add
        </Btn>
        <Btn variant="subtle" onClick={() => void sendNow()} loading={busy === "send"}>
          <Send size={13} /> Send next now
        </Btn>
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-plum-400">
        {sentState.lastSentAt && <span>Last broadcast: {new Date(sentState.lastSentAt).toLocaleTimeString()}</span>}
        {notice && <span className={`text-[12px] font-semibold ${notice.ok ? "text-emerald-600" : "text-rose-500"}`}>{notice.text}</span>}
      </div>
    </div>
  );
}

"use client";

import { ClipboardCopy, ExternalLink, Plus, RefreshCw, Trash2, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import type { Addon } from "@/db/schema";
import { cn, hexA, timeAgo } from "@/lib/format";
import { Btn, Empty, Spin, Toggle, inputCls } from "./ui";

type Item = Addon & { downloadCommand: string };
type Activation = { line: string | null; hint: string };
type Check = { status: "update" | "current" | "unknown"; updatedAt: number | null };

function fmtSubs(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function WorkshopManager({ serverId, accent, status }: { serverId: number; accent: string; status: string }) {
  const [data, setData] = useState<{ items: Item[]; activation: Activation; workshop: { appId: number; contentLabel: string } } | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<number, Check> | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    const r = await fetch(`/api/servers/${serverId}/workshop`, { cache: "no-store" });
    if (r.ok) setData((await r.json()) as never);
  }
  useEffect(() => { void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  async function add() {
    setPending("add");
    setNote(null);
    try {
      const r = await fetch(`/api/servers/${serverId}/workshop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) setNote(j.error ?? "Could not add the item");
      else { setInput(""); await load(); }
    } finally {
      setPending(null);
    }
  }

  async function checkUpdates() {
    setPending("check");
    setNote(null);
    try {
      const r = await fetch(`/api/servers/${serverId}/workshop/updates`, { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { checks?: Record<number, Check>; error?: string };
      if (!r.ok) setNote(j.error ?? "Update check failed");
      else setChecks(j.checks ?? {});
    } finally {
      setPending(null);
    }
  }

  async function importCollection() {
    setPending("collection");
    setNote(null);
    try {
      const r = await fetch(`/api/servers/${serverId}/workshop/collection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const j = (await r.json().catch(() => ({}))) as { added?: string[]; skipped?: { id: string; reason: string }[]; error?: string };
      if (!r.ok) {
        setNote(j.error ?? "Could not import the collection");
      } else {
        const parts = [`Imported ${j.added?.length ?? 0} item${(j.added?.length ?? 0) === 1 ? "" : "s"}`];
        if (j.skipped?.length) parts.push(`skipped ${j.skipped.length}`);
        setNote(parts.join(" · "));
        setInput("");
        await load();
      }
    } finally {
      setPending(null);
    }
  }

  async function markUpdated() {
    setPending("ack");
    try {
      const r = await fetch(`/api/servers/${serverId}/workshop/updates`, { method: "POST" });
      if (r.ok) {
        setChecks(null);
        await load();
      }
    } finally {
      setPending(null);
    }
  }

  async function toggle(item: Item, enabled: boolean) {
    await fetch(`/api/servers/${serverId}/addons/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    await load();
  }

  async function remove(item: Item) {
    if (!window.confirm(`Stop tracking ${item.name}?`)) return;
    await fetch(`/api/servers/${serverId}/addons/${item.id}`, { method: "DELETE" });
    await load();
  }

  function copy(text: string, tag: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(tag);
      setTimeout(() => setCopied((previous) => (previous === tag ? null : previous)), 1500);
    });
  }

  if (!data) return <div className="panel p-5"><Spin /></div>;

  return (
    <div className="panel p-5">
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <p className="font-display text-[15px] font-semibold text-plum-900">Steam Workshop</p>
          <p className="text-[12px] text-plum-500">
            {data.items.length} tracked · {data.workshop.contentLabel} for app {data.workshop.appId}
            {status === "online" ? " · changes apply on restart" : ""}
          </p>
        </div>
        {data.items.length > 0 && (
          <Btn variant="subtle" loading={pending === "check"} onClick={() => void checkUpdates()}>
            <RefreshCw size={13} /> Check for updates
          </Btn>
        )}
        {checks && Object.values(checks).some((c) => c.status === "update") && (
          <Btn variant="subtle" loading={pending === "ack"} onClick={() => void markUpdated()}>
            Mark all updated
          </Btn>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          className={cn(inputCls, "flex-1")}
          placeholder="Workshop item URL or id — e.g. https://steamcommunity.com/sharedfiles/filedetails/?id=731604991"
          value={input}
          onChange={(e) => { setInput(e.target.value); setNote(null); }}
          onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) void add(); }}
        />
        <Btn variant="primary" accent={accent} disabled={!input.trim()} loading={pending === "add"} onClick={() => void add()}>
          <Plus size={13} /> Track item
        </Btn>
        <Btn variant="outline" accent={accent} disabled={!input.trim()} loading={pending === "collection"} onClick={() => void importCollection()}>
          Import collection
        </Btn>
      </div>
      {note && <p className="mt-2 text-[12px] font-semibold text-red-600">{note}</p>}

      {data.items.length === 0 ? (
        <div className="mt-4">
          <Empty icon={<Wrench size={22} />} title="Nothing tracked yet" hint="Paste a Steam Workshop link to track it: ServerHub watches for updates and generates the activation config." />
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {data.items.map((item) => {
            const check = checks?.[item.id];
            return (
              <li key={item.id} className="rounded-xl bg-candy-50/60 px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="mr-auto min-w-0">
                    <p className="flex items-center gap-2 text-[13px] font-semibold text-plum-900">
                      <span className="truncate">{item.name}</span>
                      {check && (
                        <span
                          className={cn(
                            "rounded px-1.5 py-px text-[10px] font-bold uppercase",
                            check.status === "update" ? "bg-amber-50 text-amber-700" : check.status === "current" ? "bg-emerald-50 text-emerald-600" : "bg-candy-100 text-plum-500",
                          )}
                        >
                          {check.status === "update" ? "update available" : check.status}
                        </span>
                      )}
                    </p>
                    <p className="text-[11.5px] text-plum-500">
                      item {item.projectId} · {fmtSubs(item.downloads)} subscribers · published update {timeAgo(Number(item.version) * 1000)}
                    </p>
                  </div>
                  <a
                    className="flex items-center gap-1 text-[11.5px] font-semibold hover:underline"
                    style={{ color: hexA(accent, 0.9) }}
                    href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${item.projectId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={12} /> Workshop page
                  </a>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[11.5px] font-semibold text-plum-500 hover:text-plum-800"
                    onClick={() => copy(item.downloadCommand, `cmd-${item.id}`)}
                  >
                    <ClipboardCopy size={12} /> {copied === `cmd-${item.id}` ? "Copied!" : "SteamCMD command"}
                  </button>
                  <Toggle checked={item.enabled} onChange={(v) => void toggle(item, v)} accent={accent} />
                  <button type="button" className="text-plum-400 hover:text-red-600" onClick={() => void remove(item)} aria-label={`Remove ${item.name}`}>
                    <Trash2 size={14} />
                  </button>
                </div>
                {item.summary && <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-plum-500">{item.summary}</p>}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 rounded-xl border border-candy-200 bg-plum-900 p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-candy-200">Activation</p>
        {data.activation.line && (
          <div className="mt-1 flex items-center gap-2">
            <code className="block flex-1 break-all text-xs text-white">{data.activation.line}</code>
            <button
              type="button"
              className="shrink-0 text-[11.5px] font-semibold text-candy-200 hover:text-white"
              onClick={() => copy(data.activation.line!, "line")}
            >
              {copied === "line" ? "Copied!" : "Copy"}
            </button>
          </div>
        )}
        <p className="mt-1.5 text-[11.5px] leading-snug text-white/70">{data.activation.hint}</p>
      </div>
    </div>
  );
}

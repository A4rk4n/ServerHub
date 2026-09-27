"use client";

import { Download, Puzzle, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Addon } from "@/db/schema";
import { cn, hexA, timeAgo } from "@/lib/format";
import { Btn, Empty, Spin, Toggle, inputCls } from "./ui";

type CatalogItem = { id: string; name: string; version: string; author: string; downloads: number; summary: string; installed: boolean };

function fmtDl(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function AddonsManager({ serverId, accent, label, status }: { serverId: number; accent: string; label: string; status: string }) {
  const [data, setData] = useState<{ installed: Addon[]; catalog: CatalogItem[]; source: string } | null>(null);
  const [tab, setTab] = useState<"installed" | "browse">("installed");
  const [q, setQ] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch(`/api/servers/${serverId}/addons`, { cache: "no-store" });
      const j = await r.json();
      setData(j);
    } catch {}
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  async function install(item: CatalogItem) {
    setPending(item.id);
    try {
      const response = await fetch(`/api/servers/${serverId}/addons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: item.id }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        window.alert(result.error ?? "Installation failed");
      }
      await load();
    } finally {
      setPending(null);
    }
  }

  async function toggleA(a: Addon) {
    await fetch(`/api/servers/${serverId}/addons/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !a.enabled }),
    });
    await load();
  }

  async function uninstall(a: Addon) {
    setPending(a.name);
    try {
      await fetch(`/api/servers/${serverId}/addons/${a.id}`, { method: "DELETE" });
      await load();
    } finally {
      setPending(null);
    }
  }

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.catalog.filter((c) => (c.name + c.summary + c.author).toLowerCase().includes(q.toLowerCase()));
  }, [data, q]);

  if (!data) return <Spin label={`Loading ${label.toLowerCase()}…`} />;

  return (
    <div className="space-y-5">
      <div className="panel flex flex-wrap items-center gap-3 p-4 sm:p-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: hexA(accent, 0.1), color: accent }}>
          <Puzzle size={18} />
        </span>
        <div className="mr-auto">
          <p className="font-display text-[15px] font-semibold text-plum-900">{label}</p>
          <p className="text-[12px] text-plum-500">
            {data.installed.length} installed · source: <span style={{ color: hexA(accent, 0.9) }}>{data.source}</span>
            {status === "online" ? " · changes apply on restart" : ""}
          </p>
        </div>
        <div className="flex gap-1 rounded-xl border border-candy-200 bg-white p-1">
          {(["installed", "browse"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-lg px-3.5 py-1.5 text-[12px] font-semibold capitalize transition",
                tab === t ? "bg-candy-100 text-plum-900" : "text-plum-500 hover:text-plum-700"
              )}
            >
              {t === "installed" ? `Installed (${data.installed.length})` : "Browse"}
            </button>
          ))}
        </div>
      </div>

      {tab === "installed" ? (
        data.installed.length === 0 ? (
          <Empty
            icon={<Puzzle size={22} />}
            title="Nothing installed"
            hint={`Browse the ${data.source} catalog to extend your server.`}
            action={
              <Btn variant="primary" accent={accent} onClick={() => setTab("browse")}>
                Browse catalog
              </Btn>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {data.installed.map((a) => (
              <div key={a.id} className={cn("panel p-4 transition", !a.enabled && "opacity-55")}>
                <div className="flex items-start gap-3">
                  <span className="font-display flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[12px] font-bold" style={{ background: hexA(accent, 0.1), color: accent }}>
                    {a.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-plum-900">
                      {a.name}
                      <span className="rounded bg-candy-50 px-1.5 py-px font-mono text-[10px] text-plum-500">v{a.version}</span>
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-plum-500">{a.summary}</p>
                    <p className="mt-1.5 text-[10.5px] text-plum-400">
                      by {a.author} · {fmtDl(a.downloads)} downloads · {timeAgo(a.installedAt)}
                    </p>
                  </div>
                  <Toggle checked={a.enabled} onChange={() => toggleA(a)} accent={accent} />
                </div>
                <div className="mt-3 flex justify-end border-t border-candy-200/60 pt-2.5">
                  <button
                    onClick={() => uninstall(a)}
                    disabled={pending === a.name}
                    className="flex items-center gap-1.5 rounded-lg border border-candy-200 bg-candy-50 px-2.5 py-1.5 text-[11px] font-semibold text-plum-500 transition hover:border-red-300 hover:text-red-500 disabled:opacity-40"
                  >
                    <Trash2 size={11} /> Uninstall
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <>
          <div className="relative max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-plum-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${data.source}…`} className={cn(inputCls, "pl-9")} />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((c) => (
              <div key={c.name} className="panel panel-hover flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-display flex h-10 w-10 items-center justify-center rounded-xl text-[12px] font-bold" style={{ background: hexA(accent, 0.1), color: accent }}>
                    {c.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="flex items-center gap-1 font-mono text-[10px] text-plum-500">
                    <Download size={10} /> {fmtDl(c.downloads)}
                  </span>
                </div>
                <p className="mt-2.5 text-[13.5px] font-semibold text-plum-900">
                  {c.name} <span className="ml-1 font-mono text-[10px] font-normal text-plum-500">v{c.version}</span>
                </p>
                <p className="mt-0.5 text-[10.5px] text-plum-400">by {c.author}</p>
                <p className="mt-2 line-clamp-2 flex-1 text-[11.5px] leading-snug text-plum-500">{c.summary}</p>
                <div className="mt-3 border-t border-candy-200/60 pt-2.5">
                  {c.installed ? (
                    <span className="flex items-center justify-center gap-1.5 rounded-lg bg-candy-50 px-3 py-1.5 text-[11.5px] font-semibold text-plum-500">
                      Installed
                    </span>
                  ) : (
                    <Btn variant="outline" accent={accent} size="sm" className="w-full" onClick={() => install(c)} loading={pending === c.id}>
                      <Download size={12} /> Install
                    </Btn>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

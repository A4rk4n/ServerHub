"use client";

import { Copy, Download, Puzzle, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Addon } from "@/db/schema";
import { cn, hexA, timeAgo } from "@/lib/format";
import { Btn, Empty, Modal, Spin, Toggle, inputCls } from "./ui";

type CatalogItem = { id: string; name: string; version: string; author: string; downloads: number; summary: string; installed: boolean };

function fmtDl(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function AddonsManager({ serverId, accent, label, status }: { serverId: number; accent: string; label: string; status: string }) {
  const [data, setData] = useState<{ installed: Addon[]; catalog: CatalogItem[]; source: string; needsKey?: boolean; warning?: string } | null>(null);
  const [tab, setTab] = useState<"installed" | "browse">("installed");
  const [q, setQ] = useState("");
  const [src, setSrc] = useState<"modrinth" | "curseforge">("modrinth");
  const [cfKey, setCfKey] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<number, { latest: string | null; status: string }> | null>(null);
  const [checking, setChecking] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copySources, setCopySources] = useState<{ id: number; name: string; version: string }[]>([]);
  const [copyChoice, setCopyChoice] = useState(0);
  const [copyResult, setCopyResult] = useState<string | null>(null);

  async function load(provider: "modrinth" | "curseforge" = src) {
    try {
      const r = await fetch(`/api/servers/${serverId}/addons${provider === "curseforge" ? "?source=curseforge" : ""}`, { cache: "no-store" });
      const j = await r.json();
      setData(j);
    } catch {}
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, src]);

  const fileInput = useRef<HTMLInputElement | null>(null);

  async function uploadMod(file: File) {
    setPending("upload");
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch(`/api/servers/${serverId}/addons/upload`, { method: "POST", body: form });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) window.alert(j.error ?? "Upload failed");
      await load();
      setTab("installed");
    } finally {
      setPending(null);
    }
  }

  async function openCopy() {
    setCopyOpen(true);
    setCopyResult(null);
    const r = await fetch("/api/servers", { cache: "no-store" });
    const j = (await r.json().catch(() => ({ servers: [] }))) as { servers: { id: number; name: string; gameId: string; loader: string; version: string }[] };
    setCopySources((j.servers ?? []).filter((s) => s.id !== serverId && s.gameId === "minecraft-modded" && s.loader === "fabric"));
  }

  async function copyFrom() {
    if (!copyChoice) return;
    setPending("copy");
    try {
      const r = await fetch(`/api/servers/${serverId}/addons/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromServerId: copyChoice }),
      });
      const j = (await r.json().catch(() => ({}))) as { copied?: string[]; skipped?: { name: string; reason: string }[]; error?: string };
      if (!r.ok) {
        setCopyResult(j.error ?? "Copy failed");
      } else {
        const parts = [`Copied ${j.copied?.length ?? 0} mod${(j.copied?.length ?? 0) === 1 ? "" : "s"}`];
        if (j.skipped?.length) parts.push(`skipped ${j.skipped.length} (${j.skipped.map((s) => `${s.name}: ${s.reason}`).join("; ")})`);
        setCopyResult(parts.join(" · "));
        await load();
      }
    } finally {
      setPending(null);
    }
  }

  async function saveCfKey() {
    setPending("cf-key");
    try {
      const r = await fetch("/api/curseforge", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: cfKey }),
      });
      if (r.ok) {
        setCfKey("");
        await load();
      }
    } finally {
      setPending(null);
    }
  }

  async function install(item: CatalogItem) {
    setPending(item.id);
    try {
      const response = await fetch(`/api/servers/${serverId}/addons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: item.id, source: src }),
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

  async function checkUpdates() {
    setChecking(true);
    try {
      const r = await fetch(`/api/servers/${serverId}/addons/updates`, { cache: "no-store" });
      const j = await r.json();
      if (r.ok) {
        const map: Record<number, { latest: string | null; status: string }> = {};
        for (const c of j.checks ?? []) map[c.addonId] = { latest: c.latest, status: c.status };
        setChecks(map);
      }
    } finally {
      setChecking(false);
    }
  }

  async function updateAddon(a: Addon) {
    setPending(a.name);
    try {
      const r = await fetch(`/api/servers/${serverId}/addons/updates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addonId: a.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) window.alert(j.error ?? "Update failed");
      await load();
      await checkUpdates();
    } finally {
      setPending(null);
    }
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
        {data.installed.length > 0 && (
          <Btn variant="subtle" loading={checking} onClick={() => void checkUpdates()}>
            <RefreshCw size={13} /> Check for updates
          </Btn>
        )}
        <Btn variant="subtle" onClick={() => void openCopy()}>
          <Copy size={13} /> Copy from…
        </Btn>
        <Btn variant="subtle" loading={pending === "upload"} onClick={() => fileInput.current?.click()}>
          <Upload size={13} /> Upload .jar
        </Btn>
        <input
          ref={fileInput}
          type="file"
          accept=".jar,.zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void uploadMod(f);
          }}
        />
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
                      {checks?.[a.id]?.status === "update" && <span className="rounded bg-emerald-50 px-1.5 py-px text-[10px] font-semibold text-emerald-600">{checks[a.id].latest} available</span>}
                      {checks?.[a.id]?.status === "current" && <span className="rounded bg-plum-50 px-1.5 py-px text-[10px] font-medium text-plum-400">up to date</span>}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-plum-500">{a.summary}</p>
                    <p className="mt-1.5 text-[10.5px] text-plum-400">
                      by {a.author} · {a.source} · {fmtDl(a.downloads)} downloads · {timeAgo(a.installedAt)}
                    </p>
                  </div>
                  <Toggle checked={a.enabled} onChange={() => toggleA(a)} accent={accent} />
                </div>
                <div className="mt-3 flex justify-end gap-2 border-t border-candy-200/60 pt-2.5">
                  {checks?.[a.id]?.status === "update" && (
                    <button
                      onClick={() => updateAddon(a)}
                      disabled={pending === a.name}
                      className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-600 transition hover:border-emerald-300 disabled:opacity-40"
                    >
                      <Download size={11} /> {pending === a.name ? "Updating…" : `Update to ${checks[a.id].latest}`}
                    </button>
                  )}
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
          <div className="flex flex-wrap items-center gap-2">
            {(["modrinth", "curseforge"] as const).map((provider) => (
              <button
                key={provider}
                onClick={() => setSrc(provider)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition",
                  src === provider ? "bg-candy-100 text-plum-900" : "text-plum-500 hover:bg-candy-50 hover:text-plum-700"
                )}
              >
                {provider === "modrinth" ? "Modrinth" : "CurseForge"}
              </button>
            ))}
            <div className="relative max-w-sm flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-plum-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${data.source}…`} className={cn(inputCls, "pl-9")} />
            </div>
          </div>
          {data.needsKey && (
            <div className="panel max-w-xl p-4">
              <p className="mb-1 text-[13px] font-semibold text-plum-900">Connect CurseForge</p>
              <p className="mb-3 text-[12px] text-plum-500">
                CurseForge&apos;s API needs a personal key — free from console.curseforge.com. It is stored only on this machine and never
                shown again once saved.
              </p>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (cfKey.trim()) void saveCfKey();
                }}
              >
                <input
                  type="password"
                  value={cfKey}
                  onChange={(e) => setCfKey(e.target.value)}
                  placeholder="CurseForge API key…"
                  className={cn(inputCls, "flex-1 font-mono")}
                />
                <Btn size="sm" variant="primary" type="submit" disabled={!cfKey.trim()} loading={pending === "cf-key"}>
                  Save key
                </Btn>
              </form>
            </div>
          )}
          {data.warning && <p className="text-[12px] font-semibold text-amber-600">{data.warning}</p>}
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
      <Modal open={copyOpen} onClose={() => setCopyOpen(false)} title="Copy mods from another server">
        <p className="mb-3 text-[12px] text-plum-500">
          Copies every mod (files and tracking) from another Fabric server onto this one. Mods already installed here are
          skipped, and the servers must run the same Minecraft version.
        </p>
        {copySources.length === 0 ? (
          <p className="text-[12.5px] text-plum-500">No other Fabric servers to copy from.</p>
        ) : (
          <div className="flex items-center gap-2">
            <select className={cn(inputCls, "flex-1")} value={copyChoice} onChange={(e) => setCopyChoice(Number(e.target.value))}>
              <option value={0}>Choose a server…</option>
              {copySources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.version})
                </option>
              ))}
            </select>
            <Btn variant="primary" accent={accent} disabled={!copyChoice} loading={pending === "copy"} onClick={() => void copyFrom()}>
              Copy mods
            </Btn>
          </div>
        )}
        {copyResult && <p className="mt-3 text-[12px] font-semibold text-plum-700">{copyResult}</p>}
      </Modal>
    </div>
  );
}

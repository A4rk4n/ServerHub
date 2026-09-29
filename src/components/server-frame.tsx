"use client";

import { Activity, AlertTriangle, CalendarClock, DatabaseBackup, FolderTree, Globe2, Play, Puzzle, RotateCw, Settings, Square, Terminal, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Server } from "@/db/schema";
import { cn, hexA } from "@/lib/format";
import { InstallationProgress } from "./installation-progress";
import { Btn, Modal, StatusPill } from "./ui";

export type FrameGame = { id: string; name: string; short: string; accent: string; art: string; protocol: string; modSource: string | null; supportsMods: boolean };

export function ServerFrame({ initial, game, children }: { initial: Server; game: FrameGame; children: React.ReactNode }) {
  const pathname = usePathname();
  const [server, setServer] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [confirmKill, setConfirmKill] = useState(false);
  const previousStatus = useRef(initial.status);

  useEffect(() => {
    let dead = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/servers/${initial.id}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (!dead && j.server) {
          const nextStatus = String(j.server.status);
          if (nextStatus !== previousStatus.current && typeof Notification !== "undefined") {
            if (Notification.permission === "default") void Notification.requestPermission();
            if (Notification.permission === "granted" && ["online","crashed","error","restarting"].includes(nextStatus)) new Notification(`${initial.name}: ${nextStatus}`, { body: nextStatus === "online" ? "The game server is ready for players." : "Open Server Hub for details." });
          }
          previousStatus.current = nextStatus;
          setServer((prev) => ({ ...prev, ...j.server }));
        }
      } catch {}
    };
    const t = setInterval(poll, 3500);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [initial.id, initial.name]);

  async function power(action: string) {
    if (busy) return;
    setBusy(true);
    setConfirmKill(false);
    try {
      await fetch(`/api/servers/${server.id}/power`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
    } finally {
      setTimeout(() => setBusy(false), 1200);
    }
  }

  const base = `/servers/${server.id}`;
  const modsLabel = game.id === "minecraft" ? "Plugins" : game.id === "rust" ? "Plugins" : game.modSource?.includes("Workshop") ? "Workshop" : "Mods";
  const tabs = [
    { href: base, label: "Console", icon: Terminal, exact: true },
    { href: `${base}/players`, label: "Players", icon: Users },
    { href: `${base}/connect`, label: "Connect", icon: Globe2 },
    { href: `${base}/backups`, label: "Backups", icon: DatabaseBackup },
    { href: `${base}/tasks`, label: "Scheduler", icon: CalendarClock },
    ...(game.supportsMods ? [{ href: `${base}/mods`, label: modsLabel, icon: Puzzle }] : []),
    { href: `${base}/files`, label: "Files", icon: FolderTree },
    { href: `${base}/diagnostics`, label: "Diagnostics", icon: Activity },
    { href: `${base}/settings`, label: "Settings", icon: Settings },
  ];

  const st = server.status;
  const accent = game.accent;

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="panel flex flex-wrap items-center gap-4 p-4 sm:p-5">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-candy-200">
          {game.art ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={game.art} alt={game.short} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full" style={{ background: `linear-gradient(140deg, ${hexA(accent, 0.3)}, #fff0f8)` }} />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="font-display truncate text-xl font-bold tracking-tight text-plum-900 sm:text-2xl">{server.name}</h1>
            <StatusPill status={st} />
          </div>
          <p className="mt-1 truncate text-[12.5px] text-plum-500">
            <span style={{ color: hexA(accent, 0.95) }}>{game.name}</span>
            {" · "}v{server.version}
            {server.loader !== "vanilla" ? ` · ${server.loader}` : ""}
            {" · "}
            <span className="font-mono text-[11.5px]">{server.publicAddress}:{server.port}</span>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {st === "offline" || st === "crashed" ? (
            <Btn variant="primary" accent={accent} onClick={() => power("start")} loading={busy}>
              <Play size={15} /> Start
            </Btn>
          ) : null}
          {st === "error" ? (
            <Btn variant="primary" accent={accent} onClick={() => power("install")} loading={busy}>
              <RotateCw size={14} /> Retry installation
            </Btn>
          ) : null}
          {st === "online" ? (
            <>
              <Btn variant="subtle" onClick={() => power("restart")} loading={busy}>
                <RotateCw size={14} /> Restart
              </Btn>
              <Btn variant="danger" onClick={() => power("stop")} loading={busy}>
                <Square size={13} /> Stop
              </Btn>
            </>
          ) : null}
          {st === "restarting" ? (
            <Btn variant="danger" onClick={() => power("stop")} loading={busy}>
              <Square size={13} /> Cancel restart
            </Btn>
          ) : null}
          {["starting", "stopping", "installing"].includes(st) && (
            <Btn variant="subtle" disabled>
              <RotateCw size={14} className="animate-spin" /> {st === "installing" ? "Installing" : st === "starting" ? "Starting" : "Stopping"}…
            </Btn>
          )}
          {["online", "starting", "stopping"].includes(st) && (
            <Btn variant="ghost" size="icon" title="Force kill" onClick={() => setConfirmKill(true)}>
              <AlertTriangle size={15} className="text-red-500" />
            </Btn>
          )}
        </div>
      </div>

      <InstallationProgress serverId={server.id} accent={accent} />

      {/* tabs */}
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
        {tabs.map((t) => {
          const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "relative flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-medium transition-all",
                active ? "text-plum-900" : "text-plum-500 hover:bg-candy-50 hover:text-plum-800"
              )}
            >
              {active && (
                <span
                  className="absolute inset-0 rounded-xl border"
                  style={{ background: hexA(accent, 0.08), borderColor: hexA(accent, 0.3), boxShadow: `inset 0 -2px 0 ${accent}` }}
                />
              )}
              <t.icon size={14} className="relative" style={active ? { color: accent } : undefined} />
              <span className="relative">{t.label}</span>
            </Link>
          );
        })}
      </div>

      {children}

      <Modal open={confirmKill} onClose={() => setConfirmKill(false)} title="Force kill process?">
        <p className="text-[13.5px] leading-relaxed text-plum-500">
          Sends <span className="font-mono text-red-500">SIGKILL</span> to the process. Unsaved world progress may be lost and players will be disconnected
          without warning.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setConfirmKill(false)}>Cancel</Btn>
          <Btn variant="danger" onClick={() => power("kill")}>Kill process</Btn>
        </div>
      </Modal>
    </div>
  );
}

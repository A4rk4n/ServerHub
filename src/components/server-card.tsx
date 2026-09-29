"use client";

import { motion } from "framer-motion";
import { Cpu, MemoryStick, Play, RotateCw, Square, Timer, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn, fmtRam, fmtUptime, hexA } from "@/lib/format";
import { StatusPill } from "./ui";

export type CardServer = {
  id: number;
  name: string;
  gameId: string;
  version: string;
  loader: string;
  status: string;
  port: number;
  memoryMb: number;
  maxPlayers: number;
  motd: string;
  lastStartedAt?: string | Date | null;
  game: { id: string; short: string; name: string; accent: string; art: string; protocol: string };
  live: { cpu: number; ram: number; players: number; tps: number | null } | null;
  updateValidationStatus?: string;
  updatePreviousVersion?: string;
  updateTargetVersion?: string;
};

export function ServerCard({ server, index = 0 }: { server: CardServer; index?: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const g = server.game;
  const isOnline = server.status === "online";
  const transitioning = ["starting", "stopping", "installing"].includes(server.status) || busy !== null;

  async function power(e: React.MouseEvent, action: string) {
    e.stopPropagation();
    if (busy) return;
    setBusy(action);
    try {
      await fetch(`/api/servers/${server.id}/power`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      setTimeout(() => setBusy(null), 2500);
    } catch {
      setBusy(null);
    }
  }

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay: 0.06 * index, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4 }}
      onClick={() => router.push(`/servers/${server.id}`)}
      className="panel panel-hover group cursor-pointer overflow-hidden"
    >
      {/* art header */}
      <div className="relative h-[108px] overflow-hidden">
        {g.art ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={g.art}
            alt={g.short}
            className="h-full w-full scale-[1.03] object-cover transition-transform duration-700 ease-out group-hover:scale-110"
          />
        ) : (
          <div className="h-full w-full" style={{ background: `linear-gradient(120deg, ${hexA(g.accent, 0.25)}, #fff0f8 70%)` }} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-white via-white/70 to-transparent" />
        <div className="absolute inset-x-3 top-3 flex items-center justify-between">
          <span
            className="rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-widest backdrop-blur-md"
            style={{ color: g.accent, borderColor: hexA(g.accent, 0.3), background: "rgba(255,255,255,0.88)" }}
          >
            {g.short}
          </span>
          <StatusPill status={server.status} size="sm" />
        </div>
        <div className="absolute inset-x-3.5 bottom-2.5 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display truncate text-[17px] font-bold tracking-tight text-plum-900">{server.name}</h3>
            <p className="mt-0.5 truncate text-[11px] text-plum-500">
              v{server.version}
              {server.loader !== "vanilla" ? ` · ${server.loader}` : ""} · :{server.port}/{g.protocol.toLowerCase()}
            </p>
          </div>
        </div>
      </div>

      {/* vitals */}
      <div className="grid grid-cols-4 gap-2 px-3.5 py-3">
        <Vital icon={<Users size={12} />} label="slots" value={isOnline ? `${server.live?.players ?? 0}/${server.maxPlayers}` : `–/${server.maxPlayers}`} />
        <Vital icon={<Cpu size={12} />} label="cpu" value={isOnline ? `${server.live?.cpu ?? 0}%` : "idle"} />
        <Vital icon={<MemoryStick size={12} />} label="ram" value={isOnline ? fmtRam(server.live?.ram ?? 0) : fmtRam(server.memoryMb)} />
        <Vital icon={<Timer size={12} />} label="uptime" value={fmtUptime(server.lastStartedAt, server.status)} />
      </div>

      {server.updateValidationStatus && !["none","validated"].includes(server.updateValidationStatus) && <div className={cn("mx-3.5 mb-3 rounded-lg px-2.5 py-2 text-[10.5px] font-semibold",server.updateValidationStatus==="readiness-failed"||server.updateValidationStatus==="installation-failed"?"bg-red-50 text-red-600":"bg-amber-50 text-amber-700")}>{server.updateValidationStatus==="installing"?"Update installation in progress":server.updateValidationStatus==="awaiting-readiness"?"Update awaiting first-start validation":server.updateValidationStatus==="validating-runtime"?"Validating updated server readiness":server.updateValidationStatus==="readiness-failed"?"Updated server failed readiness — rollback is available":server.updateValidationStatus==="installation-cancelled"?"Update installation was cancelled":"Update validation needs attention"}{server.updatePreviousVersion&&server.updateTargetVersion?` · ${server.updatePreviousVersion} → ${server.updateTargetVersion}`:""}</div>}

      {/* actions */}
      <div className="flex items-center gap-2 border-t border-candy-200/60 px-3.5 py-2.5">
        <span className="mr-auto truncate text-[11px] italic text-plum-400">{server.motd || "—"}</span>
        {(server.status === "offline" || server.status === "crashed") && (
          <PowerBtn onClick={(e) => power(e, "start")} disabled={transitioning} accent={g.accent} loading={busy === "start"}>
            <Play size={12} /> Start
          </PowerBtn>
        )}
        {server.status === "error" && (
          <PowerBtn onClick={(e) => power(e, "install")} disabled={transitioning} accent={g.accent} loading={busy === "install"}>
            <RotateCw size={12} /> Retry install
          </PowerBtn>
        )}
        {server.status === "restarting" && (
          <PowerBtn onClick={(e) => power(e, "stop")} disabled={busy !== null} accent="#e2445c" loading={busy === "stop"}>
            <Square size={12} /> Cancel restart
          </PowerBtn>
        )}
        {isOnline && (
          <>
            <IconPower onClick={(e) => power(e, "restart")} disabled={transitioning} title="Restart">
              <RotateCw size={13} className={busy === "restart" ? "animate-spin" : ""} />
            </IconPower>
            <IconPower onClick={(e) => power(e, "stop")} disabled={transitioning} title="Stop" danger>
              <Square size={12} />
            </IconPower>
          </>
        )}
        {["starting", "stopping", "installing"].includes(server.status) && !busy && (
          <span className="flex items-center gap-1.5 text-[11px] text-plum-500">
            <RotateCw size={11} className="animate-spin" />
            {server.status}…
          </span>
        )}
      </div>
    </motion.article>
  );
}

function Vital({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-candy-50 px-2 py-1.5">
      <p className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-plum-500">
        {icon} {label}
      </p>
      <p className="mt-0.5 truncate font-mono text-[11.5px] font-medium text-plum-800">{value}</p>
    </div>
  );
}

function PowerBtn({ children, onClick, disabled, accent, loading }: { children: React.ReactNode; onClick: (e: React.MouseEvent) => void; disabled?: boolean; accent: string; loading?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn("flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition disabled:opacity-40")}
      style={{ background: hexA(accent, 0.14), color: accent, border: `1px solid ${hexA(accent, 0.35)}` }}
    >
      {loading ? <RotateCw size={12} className="animate-spin" /> : children}
    </button>
  );
}

function IconPower({ children, onClick, disabled, title, danger }: { children: React.ReactNode; onClick: (e: React.MouseEvent) => void; disabled?: boolean; title: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "rounded-lg border border-candy-200 bg-candy-50 p-1.5 text-plum-700 transition hover:bg-candy-100 disabled:opacity-40",
        danger && "hover:border-red-300 hover:text-red-500"
      )}
    >
      {children}
    </button>
  );
}

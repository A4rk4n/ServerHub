"use client";

import { Ban, Clock3, Crown, LogOut, ShieldCheck, ShieldOff, Undo2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import type { Player } from "@/db/schema";
import { cn, hexA, initialAvatarHue, timeAgo } from "@/lib/format";
import { Btn, Empty, Modal, Spin } from "./ui";

export function PlayersManager({ serverId, accent }: { serverId: number; accent: string }) {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [banTarget, setBanTarget] = useState<Player | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await fetch(`/api/servers/${serverId}/players`, { cache: "no-store" });
      const j = await r.json();
      if (j.players) setPlayers(j.players);
    } catch {}
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  async function act(player: Player, action: string) {
    setBusy(true);
    try {
      await fetch(`/api/servers/${serverId}/players/${player.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await load();
    } finally {
      setBusy(false);
      setBanTarget(null);
    }
  }

  if (!players) return <Spin label="Loading players…" />;

  const online = players.filter((p) => p.isOnline);
  const banned = players.filter((p) => p.isBanned);
  const totalHours = Math.round(players.reduce((a, p) => a + p.playMinutes, 0) / 60);

  return (
    <div className="space-y-5">
      {/* stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Online now", value: String(online.length), icon: Users },
          { label: "Unique players", value: String(players.length), icon: Crown },
          { label: "Total playtime", value: `${totalHours}h`, icon: Clock3 },
        ].map((s) => (
          <div key={s.label} className="panel flex items-center gap-3 p-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: hexA(accent, 0.1), color: accent }}>
              <s.icon size={16} />
            </span>
            <div>
              <p className="font-display text-lg font-bold leading-none text-plum-900">{s.value}</p>
              <p className="mt-1 text-[10.5px] font-medium uppercase tracking-wider text-plum-500">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {players.length === 0 ? (
        <Empty icon={<Users size={22} />} title="No players yet" hint="Players appear here the first time they join your server." />
      ) : (
        <div className="panel overflow-hidden">
          <div className="grid grid-cols-[1fr_90px_90px_90px_120px] items-center gap-3 border-b border-candy-200/70 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-plum-400 max-md:hidden">
            <span>Player</span>
            <span>Status</span>
            <span>Ping</span>
            <span>Playtime</span>
            <span className="text-right">Actions</span>
          </div>
          {players.map((p) => {
            const hue = initialAvatarHue(p.name);
            return (
              <div
                key={p.id}
                className={cn(
                  "grid grid-cols-[1fr_auto] items-center gap-3 border-b border-candy-200/60 px-4 py-3 transition last:border-0 hover:bg-candy-50 md:grid-cols-[1fr_90px_90px_90px_120px]",
                  p.isBanned && "bg-red-50"
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[12px] font-bold text-white"
                    style={{ background: `linear-gradient(135deg, hsl(${hue} 60% 45%), hsl(${hue + 40} 65% 30%))` }}
                  >
                    {p.name.slice(0, 2).toUpperCase()}
                    <span
                      className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white", p.isOnline ? "bg-emerald-400" : "bg-plum-300")}
                    />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-plum-900">
                      <span className="truncate">{p.name}</span>
                      {p.isOp && <ShieldCheck size={13} className="shrink-0 text-amber-500" />}
                      {p.isBanned && <Ban size={12} className="shrink-0 text-red-500" />}
                    </p>
                    <p className="truncate font-mono text-[10px] text-plum-400">{p.externalId}</p>
                  </div>
                </div>
                <span className="hidden text-[12px] md:block">
                  {p.isOnline ? (
                    <span className="font-medium text-emerald-600">online</span>
                  ) : (
                    <span className="text-plum-400">{timeAgo(p.lastSeen)}</span>
                  )}
                </span>
                <span className="hidden font-mono text-[12px] text-plum-500 md:block">{p.isOnline ? `${p.ping}ms` : "—"}</span>
                <span className="hidden font-mono text-[12px] text-plum-500 md:block">{p.playMinutes >= 60 ? `${(p.playMinutes / 60).toFixed(1)}h` : `${p.playMinutes}m`}</span>
                <div className="flex items-center justify-end gap-1">
                  {p.isBanned ? (
                    <ActionBtn title="Unban" onClick={() => act(p, "unban")} disabled={busy}>
                      <Undo2 size={14} />
                    </ActionBtn>
                  ) : (
                    <>
                      {p.isOnline && (
                        <ActionBtn title="Kick" onClick={() => act(p, "kick")} disabled={busy}>
                          <LogOut size={14} />
                        </ActionBtn>
                      )}
                      <ActionBtn title={p.isOp ? "Remove operator" : "Make operator"} onClick={() => act(p, p.isOp ? "deop" : "op")} disabled={busy}>
                        {p.isOp ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
                      </ActionBtn>
                      <ActionBtn title="Ban" danger onClick={() => setBanTarget(p)} disabled={busy}>
                        <Ban size={14} />
                      </ActionBtn>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {banned.length > 0 && (
        <p className="text-[11.5px] text-plum-400">
          {banned.length} player{banned.length > 1 ? "s are" : " is"} banned — unban from the actions column.
        </p>
      )}

      <Modal open={!!banTarget} onClose={() => setBanTarget(null)} title={`Ban ${banTarget?.name}?`}>
        <p className="text-[13.5px] leading-relaxed text-plum-500">
          The Ban Hammer will speak. <span className="text-plum-800">{banTarget?.name}</span> will be disconnected immediately and cannot rejoin until
          pardoned.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setBanTarget(null)}>Cancel</Btn>
          <Btn variant="danger" loading={busy} onClick={() => banTarget && act(banTarget, "ban")}>
            <Ban size={14} /> Ban player
          </Btn>
        </div>
      </Modal>
    </div>
  );
}

function ActionBtn({ children, onClick, title, danger, disabled }: { children: React.ReactNode; onClick: () => void; title: string; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-lg border border-candy-200 bg-candy-50 p-2 text-plum-500 transition hover:bg-candy-100 hover:text-plum-900 disabled:opacity-40",
        danger && "hover:border-red-300 hover:text-red-500"
      )}
    >
      {children}
    </button>
  );
}

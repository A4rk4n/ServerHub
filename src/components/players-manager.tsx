"use client";

import { Ban, BarChart3, Clock3, Crown, LogOut, ShieldCheck, Search, ShieldOff, Star, Undo2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import type { ModerationActionRecord, Player, PlayerSession } from "@/db/schema";
type PlayerView=Player&{observedIdentity:boolean;sessionCount:number;totalObservedSeconds:number;currentSessionSeconds:number;firstObservedAt:Date};
import { cn, hexA, initialAvatarHue, timeAgo } from "@/lib/format";
import { Btn, Empty, Modal, Spin, inputCls } from "./ui";

export function PlayersManager({ serverId, accent }: { serverId: number; accent: string }) {
  const [players, setPlayers] = useState<PlayerView[] | null>(null);
  const [sessions, setSessions] = useState<PlayerSession[]>([]);
  const [moderation,setModeration]=useState<ModerationActionRecord[]>([]);
  const [reason,setReason]=useState("");
  const [durationMinutes,setDurationMinutes]=useState(0);
  const [moderationFilter,setModerationFilter]=useState<"all"|"pending"|"failed">("all");
  const [banTarget, setBanTarget] = useState<PlayerView | null>(null);
  const [busy, setBusy] = useState(false);
  const [query,setQuery]=useState("");
  const [onlyTrusted,setOnlyTrusted]=useState(false);
  const [noteTarget,setNoteTarget]=useState<PlayerView|null>(null);
  const [note,setNote]=useState("");

  async function load() {
    try {
      const r = await fetch(`/api/servers/${serverId}/players`, { cache: "no-store" });
      const j = await r.json();
      if (j.players) setPlayers(j.players);
      if (j.sessions) setSessions(j.sessions);
      if (j.moderation) setModeration(j.moderation);
    } catch {}
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  async function act(player: PlayerView, action: string, moderationReason="", duration=0) {
    const verb=action==="unban"?"pardon":action; const command=`${verb} ${player.name}${moderationReason.trim()&&["kick","ban"].includes(action)?` ${moderationReason.trim()}`:""}`;
    if(!window.confirm(`Send this exact moderation command?\n\n${command}`))return;
    setBusy(true);
    try {
      await fetch(`/api/servers/${serverId}/players/${player.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason:moderationReason, durationMinutes:duration, confirmedCommand: command }),
      });
      await load();
    } finally {
      setBusy(false);
      setBanTarget(null);
    }
  }

  if (!players) return <Spin label="Loading players…" />;
  const shown=players.filter(player=>(!onlyTrusted||player.trusted)&&(!query||player.name.toLowerCase().includes(query.toLowerCase())));
  async function retryExpiration(item:ModerationActionRecord){setBusy(true);try{await fetch(`/api/servers/${serverId}/players/${item.playerId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({retryModerationId:item.id})});await load()}finally{setBusy(false)}}
  async function saveProfile(player:PlayerView,patch:{trusted?:boolean;notes?:string}){setBusy(true);try{await fetch(`/api/servers/${serverId}/players/${player.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(patch)});await load()}finally{setBusy(false);setNoteTarget(null)}}

  const online = players.filter((p) => p.isOnline);
  const banned = players.filter((p) => p.isBanned);
  const totalHours = Math.round(players.reduce((a, p) => a + Math.max(p.playMinutes*60,p.totalObservedSeconds), 0) / 3600);

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

      <div className="panel flex flex-wrap gap-2 p-3"><label className="relative flex-1"><Search size={14} className="absolute left-3 top-3 text-plum-400"/><input className={`${inputCls} w-full pl-9`} value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search players"/></label><Btn variant={onlyTrusted?"primary":"subtle"} onClick={()=>setOnlyTrusted(value=>!value)}><Star size={14}/> Trusted</Btn></div>
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
          {shown.map((p) => {
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
                    <p className="truncate font-mono text-[10px] text-plum-400">{p.observedIdentity?"Observed A2S name · unverified identity":p.externalId}</p>
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
                <span className="hidden font-mono text-[12px] text-plum-500 md:block">{p.isOnline&&p.currentSessionSeconds?`${Math.max(1,Math.round(p.currentSessionSeconds/60))}m now`:p.totalObservedSeconds>=3600?`${(p.totalObservedSeconds/3600).toFixed(1)}h`:`${Math.round(p.totalObservedSeconds/60)}m`}</span>
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
                      <ActionBtn title={p.trusted?"Remove trusted label":"Mark trusted"} onClick={() => void saveProfile(p,{trusted:!p.trusted})} disabled={busy}><Star size={14} fill={p.trusted?"currentColor":"none"}/></ActionBtn>
                      <ActionBtn title="Edit local notes" onClick={() => {setNoteTarget(p);setNote(p.notes)}} disabled={busy}><Clock3 size={14}/></ActionBtn>
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
      <AnalyticsPanel serverId={serverId} accent={accent} />
      {sessions.length>0&&<section className="panel p-5"><h3 className="font-display mb-3 text-sm font-semibold text-plum-900">Recent join and leave history</h3><div className="max-h-72 space-y-2 overflow-auto">{sessions.slice(0,30).map(session=><div key={session.id} className="flex items-center justify-between rounded-xl border border-candy-100 px-3 py-2 text-xs"><div><p className="font-semibold text-plum-800">{session.displayName}</p><p className="text-[10px] text-plum-400">Observed A2S name · unverified identity</p></div><div className="text-right text-plum-500"><p>{session.leftAt?`${Math.max(1,Math.round(session.durationSec/60))} min session`:"Online now"}</p><p className="text-[10px]">joined {timeAgo(session.joinedAt)}</p></div></div>)}</div></section>}
      {banned.length > 0 && (
        <p className="text-[11.5px] text-plum-400">
          {banned.length} player{banned.length > 1 ? "s are" : " is"} banned — unban from the actions column.
        </p>
      )}

      {moderation.length>0&&<section className="panel p-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-display text-sm font-semibold text-plum-900">Moderation audit</h3><div className="flex gap-1">{(["all","pending","failed"] as const).map(filter=><button key={filter} onClick={()=>setModerationFilter(filter)} className={cn("rounded-lg px-2 py-1 text-[10px] font-bold uppercase",moderationFilter===filter?"bg-candy-100 text-plum-800":"text-plum-400")}>{filter}</button>)}</div></div><div className="max-h-72 space-y-2 overflow-auto">{moderation.filter(item=>moderationFilter==="all"||(moderationFilter==="pending"&&item.status==="pending-expiration")||(moderationFilter==="failed"&&item.status==="expiration-failed")).slice(0,30).map(item=><div key={item.id} className="rounded-xl border border-candy-100 px-3 py-2 text-xs"><div className="flex items-center justify-between gap-2"><strong>{item.action} · {item.target}</strong><span className={cn("rounded-full px-2 py-0.5 text-[10px]",["sent","expiration-enforced"].includes(item.status)?"bg-emerald-50 text-emerald-600":item.status==="pending-expiration"?"bg-amber-50 text-amber-600":"bg-red-50 text-red-500")}>{item.status.replaceAll("-"," ")}</span></div><code className="mt-1 block text-[10px] text-plum-500">{item.command}</code>{item.expiresAt&&<p className="mt-1 text-[10px] text-plum-500">Expires: {new Date(item.expiresAt).toLocaleString()} · attempts {item.expirationAttempts}/3</p>}{item.status==="expiration-failed"&&<Btn className="mt-2" size="sm" variant="subtle" loading={busy} onClick={()=>void retryExpiration(item)}>Retry automatic unban</Btn>}</div>)}</div></section>}
      <Modal open={!!noteTarget} onClose={()=>setNoteTarget(null)} title={`Notes for ${noteTarget?.name}`}><textarea className={`${inputCls} min-h-28 w-full`} value={note} maxLength={1000} onChange={event=>setNote(event.target.value)} placeholder="Local administrator notes…"/><p className="mt-2 text-[11px] text-plum-400">Stored locally and excluded from support bundles.</p><div className="mt-4 flex justify-end gap-2"><Btn variant="ghost" onClick={()=>setNoteTarget(null)}>Cancel</Btn><Btn variant="primary" loading={busy} onClick={()=>noteTarget&&saveProfile(noteTarget,{notes:note})}>Save notes</Btn></div></Modal>
      <Modal open={!!banTarget} onClose={() => setBanTarget(null)} title={`Ban ${banTarget?.name}?`}>
        <p className="text-[13.5px] leading-relaxed text-plum-500">
          The exact command below will be sent after confirmation. <span className="text-plum-800">{banTarget?.name}</span> will be disconnected and cannot rejoin until pardoned.
          <code className="mt-3 block rounded-lg bg-plum-900 p-3 text-xs text-white">ban {banTarget?.name}{reason.trim()?` ${reason.trim()}`:""}</code>
        </p><input className={`${inputCls} mt-4 w-full`} value={reason} maxLength={120} onChange={event=>setReason(event.target.value)} placeholder="Reason (optional)"/><input className={`${inputCls} mt-2 w-full`} type="number" min="0" max="525600" value={durationMinutes} onChange={event=>setDurationMinutes(Number(event.target.value))} placeholder="Expiration minutes (metadata only)"/><p className="mt-2 text-[11px] text-amber-600">Expiration is recorded for administrators; automatic unban is not enabled.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setBanTarget(null)}>Cancel</Btn>
          <Btn variant="danger" loading={busy} onClick={() => banTarget && act(banTarget, "ban", reason, durationMinutes)}>
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

type AnalyticsPayload = {
  days: number;
  summary: {
    uniquePlayers: number; totalSessions: number; totalPlaytimeSec: number; avgSessionSec: number;
    peakConcurrent: number; peakAt: number | null; onlineNow: number;
    topPlayers: Array<{ key: string; name: string; playtimeSec: number; sessions: number; lastSeen: number; online: boolean }>;
    hourly: number[];
  };
  daily: Array<{ day: string; uniquePlayers: number; playtimeSec: number; peakConcurrent: number }>;
};

function hours(seconds: number) {
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(seconds < 36000 ? 1 : 0)}h`;
}

function AnalyticsPanel({ serverId, accent }: { serverId: number; accent: string }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/servers/${serverId}/analytics?days=${days}`, { cache: "no-store" });
        const j = await r.json();
        if (!dead && j.summary) setData(j);
      } catch {}
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => { dead = true; clearInterval(t); };
  }, [serverId, days]);
  const s = data?.summary;
  const maxDay = Math.max(1, ...(data?.daily.map((d) => d.playtimeSec) ?? [1]));
  const maxHour = Math.max(1, ...(s?.hourly ?? [1]));
  return (
    <section className="panel p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display flex items-center gap-2 text-sm font-semibold text-plum-900"><BarChart3 size={15} style={{ color: accent }} /> Player analytics</h3>
        <div className="flex gap-1">
          {[7, 14, 30].map((option) => (
            <button key={option} onClick={() => setDays(option)} className={cn("rounded-lg px-2 py-1 text-[10px] font-bold uppercase", days === option ? "bg-candy-100 text-plum-800" : "text-plum-400")}>{option}d</button>
          ))}
        </div>
      </div>
      {!s ? <Spin label="Crunching sessions…" /> : s.totalSessions === 0 ? (
        <p className="text-xs text-plum-500">No sessions recorded in this window yet. Join and leave events build the journal while the server runs.</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: "Unique players", value: String(s.uniquePlayers) },
              { label: "Playtime", value: hours(s.totalPlaytimeSec) },
              { label: "Peak online", value: s.peakAt ? `${s.peakConcurrent} · ${new Date(s.peakAt).toLocaleDateString()}` : String(s.peakConcurrent) },
              { label: "Avg session", value: hours(s.avgSessionSec) },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-candy-100 p-3">
                <p className="font-display text-base font-bold leading-none text-plum-900">{item.value}</p>
                <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-plum-500">{item.label}</p>
              </div>
            ))}
          </div>
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-plum-500">Daily playtime ({data.days}d)</p>
            <div className="flex h-16 items-end gap-1">
              {data.daily.map((d) => (
                <div key={d.day} className="group relative flex-1 rounded-t" style={{ height: `${Math.max(3, (d.playtimeSec / maxDay) * 100)}%`, background: d.playtimeSec ? hexA(accent, 0.55) : "rgba(0,0,0,0.06)" }} title={`${d.day}: ${hours(d.playtimeSec)} · ${d.uniquePlayers} players · peak ${d.peakConcurrent}`} />
              ))}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-plum-500">Busy hours (player-minutes)</p>
              <div className="flex h-12 items-end gap-[2px]">
                {s.hourly.map((minutes, hour) => (
                  <div key={hour} className="flex-1 rounded-t" style={{ height: `${Math.max(4, (minutes / maxHour) * 100)}%`, background: minutes ? hexA(accent, 0.4) : "rgba(0,0,0,0.06)" }} title={`${String(hour).padStart(2, "0")}:00 · ${minutes} player-minutes`} />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[9px] text-plum-400"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
            </div>
            <div>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-plum-500">Top players</p>
              <div className="space-y-1">
                {s.topPlayers.slice(0, 5).map((player, index) => (
                  <div key={player.key} className="flex items-center justify-between rounded-lg border border-candy-100 px-2.5 py-1.5 text-xs">
                    <span className="flex items-center gap-2 font-semibold text-plum-800">
                      <span className="text-[10px] text-plum-400">#{index + 1}</span>{player.name}
                      {player.online && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" title="Online now" />}
                    </span>
                    <span className="text-plum-500">{hours(player.playtimeSec)} · {player.sessions}×</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

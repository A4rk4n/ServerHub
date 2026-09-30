"use client";

import {
  Activity,
  ArrowDownToLine,
  Check,
  ChevronRight,
  Copy,
  Cpu,
  Download,
  Eraser,
  Gauge,
  Globe,
  Heart,
  MemoryStick,
  Pause,
  Play,
  Search,
  ShieldCheck,
  Users,
  Wifi,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CONSOLE_FILTERS, type ConsoleFilter, consoleSliceFileName, filterConsoleLines, formatConsoleSlice } from "@/lib/console-filter";
import { clamp, cn, fmtRam, formatClock, initialAvatarHue } from "@/lib/format";
import { AreaChart, Meter } from "./charts";

type LogLine = { id: number; ts: string; level: string; source: string; message: string };
type OnlineP = { name: string; ping: number; isOp: boolean };

const LEVEL_COLOR: Record<string, string> = {
  info: "#e9d8ee",
  warn: "#ffc774",
  error: "#ff93ab",
  success: "#82efb9",
  command: "#8ad8ff",
  system: "#ffa9e0",
};

export function ConsoleView({
  serverId,
  accent,
  protocol,
  port,
  memoryMb,
  gameId,
  isMc,
}: {
  serverId: number;
  accent: string;
  protocol: string;
  port: number;
  memoryMb: number;
  gameId: string;
  isMc: boolean;
}) {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [status, setStatus] = useState("offline");
  const [live, setLive] = useState<{ cpu: number; ram: number; players: number; tps: number | null } | null>(null);
  const [onlinePlayers, setOnlinePlayers] = useState<OnlineP[]>([]);
  const [lastStartedAt, setLastStartedAt] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<ConsoleFilter>("all");
  const [search, setSearch] = useState("");
  const [history, setHistory] = useState<number[]>([]);
  const [chartRange, setChartRange] = useState<"live" | "24h">("live");
  const [dayHistory, setDayHistory] = useState<{ t: number; cpu: number; ram: number; players: number }[]>([]);
  const [uptime, setUptime] = useState("—");
  const lastId = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const [cmd, setCmd] = useState("");
  const hist = useRef<string[]>([]);
  const histIdx = useRef(-1);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let dead = false;
    lastId.current = 0;
    const poll = async () => {
      if (paused) return;
      try {
        const r = await fetch(`/api/servers/${serverId}/console?after=${lastId.current}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (dead) return;
        if (j.logs?.length) {
          lastId.current = j.logs[j.logs.length - 1].id;
          setLogs((prev) => {
            const seen = new Set(prev.map((p: LogLine) => p.id));
            const fresh = j.logs.filter((l: LogLine) => !seen.has(l.id));
            const merged = [...prev, ...fresh];
            return merged.length > 1600 ? merged.slice(merged.length - 1600) : merged;
          });
        }
        setStatus(j.status);
        setLive(j.live ?? null);
        setOnlinePlayers(j.onlinePlayers ?? []);
        setLastStartedAt(j.lastStartedAt ?? null);
      } catch {}
    };
    poll();
    const t = setInterval(poll, 1600);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [serverId, paused]);

  useEffect(() => {
    let dead = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/servers/${serverId}/stats`, { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (!dead && j.metrics) setHistory(j.metrics.map((m: { cpu: number }) => m.cpu));
      } catch {}
    };
    poll();
    const t = setInterval(poll, 8000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [serverId]);

  useEffect(() => {
    if (chartRange !== "24h") return;
    let dead = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/servers/${serverId}/stats/history?hours=24`, { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (!dead && Array.isArray(j.points)) setDayHistory(j.points);
      } catch {}
    };
    poll();
    const t = setInterval(poll, 60_000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [serverId, chartRange]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [logs]);

  useEffect(() => {
    const tick = () => {
      if (status !== "online" || !lastStartedAt) return setUptime("—");
      const s = Math.max(0, (Date.now() - new Date(lastStartedAt).getTime()) / 1000);
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      const ss = Math.floor(s % 60);
      setUptime(d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m ${ss}s` : `${m}m ${ss}s`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [status, lastStartedAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== inputRef.current && !(document.activeElement instanceof HTMLInputElement)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const send = useCallback(async () => {
    const c = cmd.trim();
    if (!c) return;
    hist.current.unshift(c);
    hist.current = hist.current.slice(0, 30);
    histIdx.current = -1;
    setCmd("");
    await fetch(`/api/servers/${serverId}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: c }),
    });
  }, [cmd, serverId]);

  const filtered = filterConsoleLines(logs, filter, search);
  const searching = search.trim().length > 0;
  const addr = `127.0.0.1:${port}`;

  const downloadSlice = useCallback(() => {
    if (filtered.length === 0) return;
    const blob = new Blob([formatConsoleSlice(filtered)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = consoleSliceFileName(serverId);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, [filtered, serverId]);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      {/* ------------------------------ terminal ------------------------------ */}
      <div className="xl:col-span-2">
        <div className="terminal overflow-hidden rounded-[26px] border border-candy-200 shadow-[0_22px_50px_-24px_rgba(122,45,90,0.55)]">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-white/[0.06] px-4 py-3">
            <span className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff8fb4]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#ffd18c]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#9ceec4]" />
            </span>
            <span className="ml-1 font-mono text-[11px] text-white/45">console — {gameId} · real process output</span>
            <span
              className={cn(
                "ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider",
                status === "online" ? "bg-emerald-400/15 text-emerald-300" : "bg-white/10 text-white/50"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", status === "online" ? "animate-pulse-soft bg-emerald-300" : "bg-white/40")} />
              {status}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1 border-b border-white/10 px-3 py-2">
            {CONSOLE_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider transition",
                  filter === f ? "bg-candy-400 text-white" : "text-white/40 hover:bg-white/10 hover:text-white/80"
                )}
              >
                {f}
              </button>
            ))}
            <div className="ml-2 flex min-w-[140px] flex-1 items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 py-1">
              <Search size={11} className="shrink-0 text-white/35" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSearch("");
                }}
                placeholder="search output…"
                className="w-full min-w-0 bg-transparent font-mono text-[11px] text-white placeholder:text-white/30 outline-none"
              />
              {searching && (
                <>
                  <span className="shrink-0 whitespace-nowrap font-mono text-[10px] text-white/45">
                    {filtered.length} match{filtered.length === 1 ? "" : "es"}
                  </span>
                  <button onClick={() => setSearch("")} title="Clear search" className="shrink-0 text-white/40 transition hover:text-white">
                    <X size={11} />
                  </button>
                </>
              )}
            </div>
            <div className="ml-auto flex items-center gap-1">
              <ToolBtn title={paused ? "Resume stream" : "Pause stream"} onClick={() => setPaused((p) => !p)}>
                {paused ? <Play size={13} /> : <Pause size={13} />}
              </ToolBtn>
              <ToolBtn title={`Download the ${filtered.length} visible line${filtered.length === 1 ? "" : "s"} as a .log file`} onClick={downloadSlice}>
                <Download size={13} />
              </ToolBtn>
              <ToolBtn title="Clear view" onClick={() => setLogs([])}>
                <Eraser size={13} />
              </ToolBtn>
              <ToolBtn
                title="Scroll to end"
                onClick={() => {
                  pinned.current = true;
                  const el = scrollRef.current;
                  if (el) el.scrollTop = el.scrollHeight;
                }}
              >
                <ArrowDownToLine size={13} />
              </ToolBtn>
            </div>
          </div>

          <div
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
            }}
            className="h-[480px] overflow-y-auto px-4 py-3 font-mono text-[12px] leading-[1.75]"
          >
            {filtered.length === 0 && (
              <p className="py-8 text-center text-white/30">
                {logs.length > 0
                  ? searching
                    ? `— no lines match “${search.trim()}”${filter === "all" ? "" : ` in ${filter}`} —`
                    : `— no ${filter} lines yet —`
                  : status === "offline"
                    ? "— server is offline · start it to stream the console —"
                    : "waiting for output…"}
              </p>
            )}
            {filtered.map((l) => (
              <div key={l.id} className="group flex gap-3 whitespace-pre-wrap break-words rounded-lg px-1.5 py-px hover:bg-white/[0.06]">
                <span className="shrink-0 select-none text-white/25">{formatClock(l.ts)}</span>
                <span className="min-w-0" style={{ color: LEVEL_COLOR[l.level] ?? "#e9d8ee" }}>
                  {l.level === "system" && (
                    <span className="mr-2 rounded bg-candy-400/25 px-1.5 py-px text-[10px] uppercase tracking-wider text-candy-200">{l.source.toLowerCase()}</span>
                  )}
                  {l.message}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2.5 border-t border-white/10 bg-white/[0.05] px-4 py-3.5">
            <ChevronRight size={15} className="text-candy-300" />
            <input
              ref={inputRef}
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void send();
                else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  if (hist.current.length) {
                    histIdx.current = clamp(histIdx.current + 1, 0, hist.current.length - 1);
                    setCmd(hist.current[histIdx.current]);
                  }
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  histIdx.current = Math.max(-1, histIdx.current - 1);
                  setCmd(histIdx.current === -1 ? "" : hist.current[histIdx.current]);
                }
              }}
              placeholder={`Type a command — try "help"${status !== "online" ? " (server offline)" : ""} · "/" to focus`}
              className="flex-1 bg-transparent font-mono text-[12.5px] text-white placeholder:text-white/30 outline-none"
            />
            {!cmd && <span className="caret-blink h-4 w-2 rounded-sm bg-candy-300" />}
          </div>
        </div>
      </div>

      {/* ------------------------------ vitals rail ------------------------------ */}
      <div className="space-y-4">
        <div className="panel p-5">
          <h3 className="font-display mb-4 flex items-center gap-2 text-[14px] font-bold text-plum-900">
            <Activity size={15} style={{ color: accent }} /> Live vitals
          </h3>
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-plum-400"><Cpu size={11} /> CPU</span>
              <span className="font-mono font-semibold text-plum-800">{status === "online" ? `${live?.cpu?.toFixed(1) ?? "…"}%` : "idle"}</span>
            </div>
            <Meter value={status === "online" ? (live?.cpu ?? 0) : 0} max={100} color={accent} />
          </div>
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-plum-400"><MemoryStick size={11} /> RAM</span>
              <span className="font-mono font-semibold text-plum-800">
                {status === "online" ? `${fmtRam(live?.ram ?? 0)} / ${fmtRam(memoryMb)}` : `0 / ${fmtRam(memoryMb)}`}
              </span>
            </div>
            <Meter value={status === "online" ? (live?.ram ?? 0) : 0} max={memoryMb} color="#c77dff" />
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <MiniStat icon={<Gauge size={11} />} label={isMc ? "TPS" : "tick"} value={status === "online" ? String(live?.tps ?? "n/a") : "—"} />
            <MiniStat icon={<Wifi size={11} />} label="uptime" value={uptime} />
          </div>
          <div className="mt-4 border-t border-candy-200/70 pt-3">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-plum-400">{chartRange === "live" ? "cpu · last 8 min" : "cpu · last 24 h"}</p>
              <div className="flex gap-1">
                {(["live", "24h"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setChartRange(r)}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition ${chartRange === r ? "bg-candy-100 text-candy-700" : "text-plum-300 hover:text-plum-500"}`}
                  >
                    {r === "live" ? "Live" : "24 h"}
                  </button>
                ))}
              </div>
            </div>
            {chartRange === "live" ? (
              <AreaChart id="rail-cpu" values={history.length ? history : [0]} color={accent} height={72} unit="%" />
            ) : dayHistory.length === 0 ? (
              <p className="py-4 text-center text-[11px] text-plum-400">No history yet — it builds up while the server runs.</p>
            ) : (
              <div className="space-y-3">
                <AreaChart id="day-cpu" values={dayHistory.map((p) => p.cpu)} color={accent} height={72} unit="%" />
                <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-plum-400">ram · last 24 h</p>
                <AreaChart id="day-ram" values={dayHistory.map((p) => p.ram)} color="#c77dff" height={56} unit=" MB" />
                <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-plum-400">players · last 24 h</p>
                <AreaChart id="day-players" values={dayHistory.map((p) => p.players)} color="#22c58b" height={56} unit="" />
              </div>
            )}
          </div>
        </div>

        <div className="panel p-5">
          <h3 className="font-display mb-3 flex items-center gap-2 text-[14px] font-bold text-plum-900">
            <Globe size={15} style={{ color: accent }} /> Connect
          </h3>
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(addr).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            }}
            className="group flex w-full items-center justify-between rounded-2xl border border-candy-200 bg-candy-50 px-4 py-3 font-mono text-[13px] font-semibold text-plum-800 transition hover:border-candy-400 hover:bg-candy-100"
          >
            {addr}
            {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} className="text-plum-300 transition group-hover:text-candy-600" />}
          </button>
          <p className="mt-2.5 flex items-center justify-between text-[11px] text-plum-400">
            <span>protocol</span>
            <span className="font-mono font-semibold text-plum-600">{protocol.toLowerCase()}</span>
          </p>
        </div>

        <div className="panel p-5">
          <h3 className="font-display mb-3 flex items-center justify-between text-[14px] font-bold text-plum-900">
            <span className="flex items-center gap-2"><Users size={15} style={{ color: accent }} /> Players online</span>
            <span className="rounded-full bg-candy-100 px-2.5 py-0.5 font-mono text-[10.5px] font-bold text-candy-600">{onlinePlayers.length}</span>
          </h3>
          {onlinePlayers.length === 0 ? (
            <p className="flex items-center gap-1.5 py-2 text-[12px] text-plum-400">
              {status === "online" ? (
                <>
                  No adventurers right now <Heart size={10} fill="currentColor" className="text-candy-300" />
                </>
              ) : (
                "Server offline."
              )}
            </p>
          ) : (
            <div className="space-y-1">
              {onlinePlayers.map((p) => {
                const hue = initialAvatarHue(p.name);
                return (
                  <div key={p.name} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition hover:bg-candy-50">
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-bold text-white"
                      style={{ background: `linear-gradient(135deg, hsl(${hue} 78% 68%), hsl(${hue + 40} 72% 56%))` }}
                    >
                      {p.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-plum-700">{p.name}</span>
                    {p.isOp && <ShieldCheck size={12} className="text-amber-500" />}
                    <span className="font-mono text-[10px] text-plum-400">{p.ping}ms</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button onClick={onClick} title={title} className="rounded-full p-1.5 text-white/45 transition hover:bg-white/15 hover:text-white">
      {children}
    </button>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-candy-50 px-3 py-2">
      <p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-plum-400">{icon} {label}</p>
      <p className="mt-0.5 truncate font-mono text-[12.5px] font-semibold text-plum-800">{value}</p>
    </div>
  );
}

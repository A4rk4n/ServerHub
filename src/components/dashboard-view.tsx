"use client";

import { motion } from "framer-motion";
import {
  Activity,
  ArrowUpRight,
  CalendarClock,
  Cpu,
  DatabaseBackup,
  HardDrive,
  Heart,
  MemoryStick,
  Plus,
  Power,
  Puzzle,
  Server as ServerIcon,
  Settings2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { OverviewData } from "@/lib/overview-data";
import { cn, fmtRam, hexA, timeAgo } from "@/lib/format";
import { AreaChart, Meter, Ring } from "./charts";
import { ServerCard } from "./server-card";
import { Btn, Empty } from "./ui";

const ease = [0.22, 1, 0.36, 1] as const;

export function DashboardView({ initial }: { initial: OverviewData }) {
  const [data, setData] = useState(initial);
  const [metric, setMetric] = useState<"cpu" | "ram">("cpu");

  useEffect(() => {
    let dead = false;
    const poll = async () => {
      try {
        const r = await fetch("/api/overview", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (!dead && j.totals) setData(j);
      } catch {}
    };
    const t = setInterval(poll, 6000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, []);

  const t = data.totals;
  const series = data.series.map((p) => (metric === "cpu" ? p.cpu : p.ram / 1024));
  const nodeRamGb = 64;

  return (
    <div className="space-y-6">
      {/* ------------------------------ hero ------------------------------ */}
      <section className="relative overflow-hidden rounded-3xl border border-candy-200">
        <div className="pointer-events-none absolute inset-0">
          <div className="float-slow absolute -left-24 -top-32 h-80 w-96 rounded-full opacity-55 blur-[100px]" style={{ background: "#ffb3dd" }} />
          <div className="float-slow absolute -right-16 -bottom-40 h-96 w-[28rem] rounded-full opacity-45 blur-[100px]" style={{ background: "#d3c4ff", animationDelay: "3s" }} />
          <div className="float-slow absolute right-1/3 -top-20 h-64 w-72 rounded-full opacity-40 blur-[100px]" style={{ background: "#b8e8ff", animationDelay: "5s" }} />
          <div className="dot-grid absolute inset-0 opacity-50 [mask-image:radial-gradient(75%_100%_at_25%_0%,black,transparent)]" />
        </div>
        <div className="relative flex flex-wrap items-end gap-8 p-7 sm:p-9">
          <div className="min-w-[280px] flex-1">
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease }}
              className="mb-3 inline-flex items-center gap-2 rounded-full border border-candy-200 bg-white/80 px-3.5 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.2em] text-candy-600"
            >
              <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-emerald-400" />
              Local runtime ready
              <Heart size={10} fill="currentColor" className="text-candy-400" />
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.06, ease }}
              className="font-display text-[40px] font-bold leading-[1.02] tracking-tight text-plum-900 sm:text-[54px]"
            >
              Command every
              <span className="grad-text"> world.</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.14, ease }}
              className="mt-4 max-w-xl text-[15px] leading-relaxed text-plum-500"
            >
              One beautiful panel for Minecraft, Valheim, ARK, RuneScape: Dragonwilds, Hytale and the rest of your fleet — live consoles, players, backups,
              schedules and mods under a single roof.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.22, ease }}
              className="mt-6 flex flex-wrap gap-3"
            >
              <Link href="/servers/new">
                <Btn variant="primary" size="lg">
                  <Plus size={17} /> Deploy a server
                </Btn>
              </Link>
              <Link href="/servers">
                <Btn variant="subtle" size="lg">
                  Browse fleet <ArrowUpRight size={15} />
                </Btn>
              </Link>
            </motion.div>
          </div>
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.2, ease }}
            className="flex items-center gap-7 rounded-[26px] border border-candy-200 bg-white/80 px-7 py-5 shadow-[0_12px_32px_-18px_rgba(244,63,146,0.5)] backdrop-blur-sm"
          >
            <div className="text-center">
              <Ring value={t.cpu} max={100} color="#ff5fa8" label={`${Math.round(t.cpu)}%`} sub="cpu" />
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-plum-500">Fleet CPU</p>
            </div>
            <div className="text-center">
              <Ring value={t.ram / 1024} max={nodeRamGb} color="#c77dff" label={(t.ram / 1024).toFixed(1)} sub="gb ram" />
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-plum-500">Memory</p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ------------------------------ stats ------------------------------ */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { icon: ServerIcon, label: "Servers online", value: `${t.online}/${t.servers}`, color: "#ff5fa8", frac: t.servers ? t.online / t.servers : 0 },
          { icon: Users, label: "Players online", value: String(t.playersOnline), color: "#c77dff", frac: Math.min(1, t.playersOnline / 40) },
          { icon: DatabaseBackup, label: "Backups stored", value: `${t.backups} · ${(t.storageMb / 1000).toFixed(1)} GB`, color: "#6ec7ff", frac: 0.4 },
          { icon: CalendarClock, label: "Active schedules", value: String(t.tasksEnabled), color: "#ffa93d", frac: 0.5 },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.25 + i * 0.07, ease }}
            className="panel panel-hover p-4"
          >
            <div className="flex items-center justify-between">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: hexA(s.color, 0.12), color: s.color }}>
                <s.icon size={15} />
              </span>
              <motion.span key={s.value} initial={{ opacity: 0.3 }} animate={{ opacity: 1 }} className="font-display text-xl font-bold tracking-tight text-plum-900">
                {s.value}
              </motion.span>
            </div>
            <p className="mt-2.5 text-[11px] font-medium uppercase tracking-wider text-plum-500">{s.label}</p>
            <div className="mt-2.5">
              <Meter value={s.frac} max={1} color={s.color} />
            </div>
          </motion.div>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* ------------------------------ servers ------------------------------ */}
        <div className="space-y-5 xl:col-span-2">
          {/* fleet chart */}
          <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.4, ease }} className="panel p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="font-display text-[15px] font-semibold tracking-tight text-plum-900">Fleet load</h2>
                <p className="text-[11px] text-plum-500">rolling 8 minutes · updates live</p>
              </div>
              <div className="flex gap-1 rounded-lg border border-candy-200 bg-white p-0.5">
                {(["cpu", "ram"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMetric(m)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition",
                      metric === m ? "bg-candy-100 text-plum-900" : "text-plum-500 hover:text-plum-700"
                    )}
                  >
                    {m === "cpu" ? "CPU %" : "RAM GB"}
                  </button>
                ))}
              </div>
            </div>
            <AreaChart id={`fleet-${metric}`} values={series.length ? series : [0]} color={metric === "cpu" ? "#ff5fa8" : "#c77dff"} height={140} unit={metric === "cpu" ? "%" : "GB"} />
            <div className="mt-1 flex items-center gap-4 font-mono text-[10px] text-plum-500">
              <span className="flex items-center gap-1.5"><Cpu size={11} className="text-candy-500" /> now {t.cpu}%</span>
              <span className="flex items-center gap-1.5"><MemoryStick size={11} className="text-[#c77dff]" /> {fmtRam(t.ram)} committed</span>
              <span className="flex items-center gap-1.5"><HardDrive size={11} className="text-plum-400" /> node disk 41%</span>
            </div>
          </motion.section>

          {/* servers grid */}
          <section>
            <div className="mb-3.5 flex items-center justify-between">
              <h2 className="font-display flex items-center gap-2 text-[15px] font-semibold tracking-tight text-plum-900">
                Your servers
                <span className="rounded-full border border-candy-200 bg-candy-50 px-2 py-0.5 text-[10px] font-bold text-plum-500">{data.servers.length}</span>
              </h2>
              <Link href="/servers/new" className="flex items-center gap-1.5 text-[12.5px] font-medium text-emerald-600 transition hover:text-emerald-600">
                <Plus size={14} /> New server
              </Link>
            </div>
            {data.servers.length === 0 ? (
              <Empty
                icon={<ServerIcon size={22} />}
                title="No servers yet"
                hint="Deploy your first world — Minecraft, Valheim, ARK and more are ready to go."
                action={
                  <Link href="/servers/new">
                    <Btn variant="primary">
                      <Plus size={15} /> Create server
                    </Btn>
                  </Link>
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {data.servers.map((s, i) => (
                  <ServerCard key={s.id} server={s as never} index={i} />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ------------------------------ activity ------------------------------ */}
        <motion.aside initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.5, ease }} className="panel h-fit p-5 xl:sticky xl:top-6">
          <h2 className="font-display mb-1 flex items-center gap-2 text-[15px] font-semibold tracking-tight text-plum-900">
            <Activity size={15} className="text-candy-500" /> Live activity
          </h2>
          <p className="mb-4 text-[11px] text-plum-500">fleet events · polling every 6s</p>
          <div className="relative space-y-0.5">
            <div className="absolute bottom-2 left-[13px] top-2 w-px bg-gradient-to-b from-candy-200 via-candy-100 to-transparent" />
            {data.activity.slice(0, 16).map((a) => (
              <ActivityRow key={a.id} a={a} servers={data.servers} />
            ))}
          </div>
        </motion.aside>
      </div>
    </div>
  );
}

const KIND_META: Record<string, { icon: never; color: string }> = {
  power: { icon: Power as never, color: "#17ab72" },
  backup: { icon: DatabaseBackup as never, color: "#3aa8e0" },
  player: { icon: Users as never, color: "#c77dff" },
  task: { icon: CalendarClock as never, color: "#e09a20" },
  server: { icon: ServerIcon as never, color: "#8b7aa8" },
  addon: { icon: Puzzle as never, color: "#ff5fa8" },
  settings: { icon: Settings2 as never, color: "#a886ad" },
};

function ActivityRow({ a, servers }: { a: OverviewData["activity"][number]; servers: OverviewData["servers"] }) {
  const meta = KIND_META[a.kind] ?? KIND_META.server;
  const Icon = meta.icon as unknown as React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  const srv = servers.find((s) => s.id === a.serverId);
  return (
    <div className="relative flex gap-3 rounded-xl py-2 pl-0.5 pr-1 transition hover:bg-candy-50">
      <span
        className="relative z-10 mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border"
        style={{ background: hexA(meta.color, 0.1), borderColor: hexA(meta.color, 0.35), color: meta.color }}
      >
        <Icon size={12} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] leading-snug text-plum-700">{a.message}</p>
        <p className="mt-0.5 flex items-center gap-2 text-[10.5px] text-plum-400">
          <span>{timeAgo(a.ts)}</span>
          {srv && (
            <Link href={`/servers/${srv.id}`} className="truncate font-medium hover:underline" style={{ color: hexA(srv.game.accent, 0.85) }}>
              {srv.name}
            </Link>
          )}
        </p>
      </div>
    </div>
  );
}

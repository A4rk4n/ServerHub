import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { activity, backups, players, servers, tasks } from "@/db/schema";
import { getGame } from "./games";
import { readAllServerTags } from "./server-tags";
import { readAllMaintenance } from "./maintenance";
import { ensureRuntimeInitialized, metricsFor } from "./runtime";

export type ServerCardData = Awaited<ReturnType<typeof getOverview>>["servers"][number];
export type OverviewData = Awaited<ReturnType<typeof getOverview>>;

export async function getOverview() {
  await ensureRuntimeInitialized();
  const rows = await db.select().from(servers);
  const allTags = await readAllServerTags();
  const allMaintenance = await readAllMaintenance();
  const cards = [];
  let cpu = 0;
  let ram = 0;
  let online = 0;
  let playersOnline = 0;
  const seriesSets: { t: number; cpu: number; ram: number }[][] = [];
  for (const s of rows) {
    const m = s.status === "online" ? (await metricsFor(s)).at(-1) : null;
    if (s.status === "online") {
      online++;
      cpu += m?.cpu ?? 8;
      ram += m?.ram ?? s.memoryMb * 0.5;
      const ms = await metricsFor(s);
      seriesSets.push(ms.map((x) => ({ t: x.t, cpu: x.cpu, ram: x.ram })));
      const ps = await db.select().from(players).where(eq(players.serverId, s.id));
      playersOnline += ps.filter((p) => p.isOnline).length;
    }
    const g = getGame(s.gameId);
    cards.push({
      ...s,
      game: { id: g.id, short: g.short, name: g.name, accent: g.accent, art: g.art, protocol: g.protocol },
      live: m ? { cpu: m.cpu, ram: m.ram, players: m.players, tps: m.tps } : null,
      tags: allTags[String(s.id)] ?? [],
      maintenance: allMaintenance[String(s.id)]?.enabled ?? false,
    });
  }
  const acts = await db.select().from(activity).orderBy(desc(activity.id)).limit(26);
  const bks = await db.select().from(backups);
  const tks = await db.select().from(tasks);
  const series: { t: number; cpu: number; ram: number }[] = [];
  if (seriesSets.length) {
    const n = Math.min(...seriesSets.map((s) => s.length));
    for (let i = 0; i < n; i++) {
      let c = 0;
      let r = 0;
      let t = 0;
      for (const set of seriesSets) {
        const p = set[set.length - n + i];
        c += p.cpu;
        r += p.ram;
        t = p.t;
      }
      series.push({ t, cpu: +c.toFixed(1), ram: Math.round(r) });
    }
  }
  const enriched = acts.map((a) => {
    const s = rows.find((r) => r.id === a.serverId);
    return { ...a, serverName: s?.name ?? null };
  });
  return {
    totals: {
      servers: rows.length,
      online,
      playersOnline,
      cpu: +cpu.toFixed(1),
      ram: Math.round(ram),
      backups: bks.length,
      storageMb: bks.reduce((a, b) => a + b.sizeMb, 0),
      tasksEnabled: tks.filter((t) => t.enabled).length,
    },
    activity: enriched,
    series,
    servers: cards,
  };
}

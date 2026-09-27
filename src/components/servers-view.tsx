"use client";

import { motion } from "framer-motion";
import { Boxes, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CardServer } from "./server-card";
import { ServerCard } from "./server-card";
import { Btn, Empty, inputCls } from "./ui";

const FILTERS = ["all", "online", "offline"] as const;

export function ServersView({ initial }: { initial: CardServer[] }) {
  const [servers, setServers] = useState(initial);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");

  useEffect(() => {
    let dead = false;
    const poll = async () => {
      try {
        const r = await fetch("/api/servers", { cache: "no-store" });
        const j = await r.json();
        if (!dead && j.servers) setServers(j.servers);
      } catch {}
    };
    const t = setInterval(poll, 7000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, []);

  const filtered = useMemo(() => {
    return servers.filter((s) => {
      if (filter === "online" && s.status !== "online") return false;
      if (filter === "offline" && !["offline", "crashed", "error"].includes(s.status)) return false;
      if (q && !(s.name + s.game.name + s.gameId).toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [servers, q, filter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }} className="font-display text-3xl font-bold tracking-tight text-plum-900">
            Servers
          </motion.h1>
          <p className="mt-1 text-[13.5px] text-plum-500">
            {servers.filter((s) => s.status === "online").length} of {servers.length} server processes running on this PC
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-plum-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search servers…" className={`${inputCls} w-52 pl-9`} />
          </div>
          <Link href="/servers/new">
            <Btn variant="primary">
              <Plus size={15} /> New server
            </Btn>
          </Link>
        </div>
      </div>

      <div className="flex gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold capitalize transition ${
              filter === f ? "bg-candy-100 text-plum-900" : "text-plum-500 hover:bg-candy-50 hover:text-plum-700"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Empty
          icon={<Boxes size={22} />}
          title={q ? "Nothing matches your search" : "No servers here yet"}
          hint={q ? "Try a different name or clear the filter." : "Deploy your first instance and watch it boot in real time."}
          action={
            <Link href="/servers/new">
              <Btn variant="primary">
                <Plus size={15} /> Create server
              </Btn>
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((s, i) => (
            <ServerCard key={s.id} server={s} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

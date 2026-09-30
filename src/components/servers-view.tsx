"use client";

import { motion } from "framer-motion";
import { Boxes, Play, Plus, RotateCw, Search, Square } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { type BulkAction, partitionBulkAction } from "@/lib/bulk-power";
import type { CardServer } from "./server-card";
import { ServerCard } from "./server-card";
import { Btn, Empty, inputCls } from "./ui";

const FILTERS = ["all", "online", "offline"] as const;

const BULK_META: Record<BulkAction, { label: string; icon: React.ComponentType<{ size?: number | string }>; danger: boolean }> = {
  start: { label: "Start", icon: Play, danger: false },
  restart: { label: "Restart", icon: RotateCw, danger: false },
  stop: { label: "Stop", icon: Square, danger: true },
};

export function ServersView({ initial }: { initial: CardServer[] }) {
  const [servers, setServers] = useState(initial);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [arming, setArming] = useState<BulkAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const filtered = useMemo(() => {
    return servers.filter((s) => {
      if (filter === "online" && s.status !== "online") return false;
      if (filter === "offline" && !["offline", "crashed", "error"].includes(s.status)) return false;
      if (q && !(s.name + s.game.name + s.gameId).toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [servers, q, filter]);

  async function runBulk(action: BulkAction) {
    const { eligible } = partitionBulkAction(filtered, action);
    if (eligible.length === 0) return;
    // Two-click confirmation: the first click arms the button for 4s.
    if (arming !== action) {
      setArming(action);
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArming(null), 4000);
      return;
    }
    setArming(null);
    setBusy(true);
    try {
      const r = await fetch("/api/servers/bulk-power", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: eligible.map((s) => s.id) }),
      });
      const j = await r.json();
      if (!r.ok) setNotice(j.error ?? "Bulk action failed");
      else {
        const results = j.results as Array<{ outcome: string }>;
        const done = results.filter((x) => x.outcome === "ok").length;
        const scheduled = results.filter((x) => x.outcome === "scheduled").length;
        const failed = results.filter((x) => x.outcome === "failed").length;
        const skipped = results.filter((x) => x.outcome === "skipped").length;
        setNotice(
          [
            scheduled ? `${scheduled} start${scheduled === 1 ? "" : "s"} scheduled (2.5s apart)` : "",
            done ? `${done} ${action === "stop" ? "stopping" : "restarting"}` : "",
            failed ? `${failed} failed` : "",
            skipped ? `${skipped} skipped` : "",
          ]
            .filter(Boolean)
            .join(" · ")
        );
      }
    } catch {
      setNotice("Bulk action failed");
    } finally {
      setBusy(false);
    }
  }

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

      <div className="flex flex-wrap items-center gap-1.5">
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
        {servers.length > 1 && (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-plum-400">
              fleet{filter !== "all" || q ? " (filtered)" : ""}
            </span>
            {(Object.keys(BULK_META) as BulkAction[]).map((action) => {
              const meta = BULK_META[action];
              const count = partitionBulkAction(filtered, action).eligible.length;
              const armed = arming === action;
              return (
                <Btn
                  key={action}
                  size="sm"
                  variant={armed ? (meta.danger ? "danger" : "primary") : "subtle"}
                  disabled={count === 0 || busy}
                  onClick={() => void runBulk(action)}
                  title={`${meta.label} the ${count} eligible server${count === 1 ? "" : "s"} shown`}
                >
                  <meta.icon size={13} /> {armed ? `Confirm ${meta.label.toLowerCase()} ${count}?` : `${meta.label} ${count > 0 ? count : ""}`}
                </Btn>
              );
            })}
            {notice && <span className="ml-1 text-[11.5px] font-semibold text-plum-500">{notice}</span>}
          </div>
        )}
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

"use client";

import { Activity, Gamepad2, RefreshCw, Users } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatUptime, type StatusSnapshot } from "@/lib/status-page";

const BAR_STYLE: Record<string, string> = {
  up: "bg-emerald-400",
  degraded: "bg-amber-400",
  down: "bg-rose-400",
  maintenance: "bg-sky-300",
  none: "bg-candy-100",
};

function barTitle(day: { date: string; pct: number | null; state: string }): string {
  if (day.state === "maintenance") return `${day.date}: maintenance`;
  if (day.pct === null) return `${day.date}: no data`;
  return `${day.date}: ${day.pct}% uptime`;
}

/** The classic 90-day uptime strip: oldest on the left, today on the right. */
function UptimeStrip({ uptime }: { uptime: { windowPct: number | null; days: { date: string; pct: number | null; state: string }[] } }) {
  return (
    <div className="mt-3">
      <div className="flex h-7 items-stretch gap-px">
        {uptime.days.map((day) => (
          <span key={day.date} title={barTitle(day)} className={`min-w-0 flex-1 rounded-[1px] ${BAR_STYLE[day.state] ?? BAR_STYLE.none}`} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10.5px] text-plum-400">
        <span>90 days ago</span>
        <span>{uptime.windowPct !== null ? `${uptime.windowPct}% uptime` : "collecting data"}</span>
        <span>today</span>
      </div>
    </div>
  );
}

const STATUS_STYLE: Record<string, { label: string; dot: string; text: string }> = {
  online: { label: "Online", dot: "bg-emerald-500", text: "text-emerald-600" },
  offline: { label: "Offline", dot: "bg-rose-400", text: "text-rose-500" },
  maintenance: { label: "Maintenance", dot: "bg-amber-400", text: "text-amber-600" },
};

export function StatusPageView() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await fetch(`/api/status?token=${encodeURIComponent(token)}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setSnapshot(j);
        setError("");
      } else {
        setError(r.status === 401 ? "This status link is invalid or has been replaced." : "This status page is not available.");
      }
    } catch {
      setError("The status page could not be reached.");
    } finally {
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-candy-50 to-white px-4 py-10">
      <div className="mx-auto w-full max-w-3xl">
        {error ? (
          <div className="rounded-2xl border border-candy-200 bg-white p-8 text-center shadow-sm">
            <Gamepad2 size={28} className="mx-auto mb-3 text-candy-400" />
            <p className="text-[14px] font-semibold text-plum-800">{error}</p>
            <p className="mt-1 text-[12px] text-plum-400">Ask the server owner for a fresh link.</p>
          </div>
        ) : snapshot ? (
          <>
            <div className="mb-6 text-center">
              <h1 className="font-display text-[26px] font-bold text-plum-900">{snapshot.title}</h1>
              <div className="mt-2 flex items-center justify-center gap-4 text-[12.5px] text-plum-500">
                <span className="flex items-center gap-1.5">
                  <Activity size={14} className="text-emerald-500" />
                  {snapshot.totals.online}/{snapshot.totals.servers} online
                </span>
                <span className="flex items-center gap-1.5">
                  <Users size={14} className="text-candy-500" />
                  {snapshot.totals.players} playing now
                </span>
                <span className="flex items-center gap-1.5 text-plum-400">
                  <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
                  {new Date(snapshot.generatedAt).toLocaleTimeString()}
                </span>
              </div>
            </div>
            <div className="space-y-3">
              {snapshot.servers.length === 0 ? (
                <div className="rounded-2xl border border-candy-200 bg-white p-8 text-center text-[13px] text-plum-400 shadow-sm">
                  No servers to show yet.
                </div>
              ) : (
                snapshot.servers.map((server) => {
                  const style = STATUS_STYLE[server.status] ?? STATUS_STYLE.offline;
                  return (
                    <div key={server.name} className="rounded-2xl border border-candy-200 bg-white px-5 py-4 shadow-sm">
                      <div className="flex items-center gap-4">
                        <span className={`h-3 w-3 shrink-0 rounded-full ${style.dot}`} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14px] font-bold text-plum-900">{server.name}</div>
                          <div className="truncate text-[12px] text-plum-500">
                            {server.game} · {server.version}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className={`text-[12.5px] font-semibold ${style.text}`}>
                            {style.label}
                            {server.status === "online" && server.uptimeSec !== null ? ` · ${formatUptime(server.uptimeSec)}` : ""}
                          </div>
                          <div className="text-[12px] text-plum-500">
                            <Users size={11} className="mr-1 inline" />
                            {server.players.online}/{server.players.max}
                          </div>
                        </div>
                      </div>
                      {server.uptime && <UptimeStrip uptime={server.uptime} />}
                    </div>
                  );
                })
              )}
            </div>
            <p className="mt-8 text-center text-[11px] text-plum-300">Powered by Server Hub · read-only status</p>
          </>
        ) : (
          <div className="py-16 text-center text-[13px] text-plum-400">Loading status…</div>
        )}
      </div>
    </div>
  );
}

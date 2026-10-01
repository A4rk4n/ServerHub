"use client";

import { Archive, Download, FileText, ListFilter, Power, RefreshCw, ScrollText, Shield, Users, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AUDIT_CATEGORIES, type AuditCategory, type AuditEvent } from "@/lib/audit-trail";
import { timeAgo } from "@/lib/format";
import { Btn, Spin, inputCls } from "./ui";

const CATEGORY_META: Record<AuditCategory, { label: string; color: string; icon: typeof Power }> = {
  power: { label: "Power", color: "#f59e0b", icon: Power },
  files: { label: "Files", color: "#60a5fa", icon: FileText },
  backups: { label: "Backups", color: "#34d399", icon: Archive },
  roster: { label: "Roster", color: "#a78bfa", icon: Users },
  tasks: { label: "Tasks", color: "#f472b6", icon: Wrench },
  security: { label: "Security", color: "#ef4444", icon: Shield },
  other: { label: "Other", color: "#94a3b8", icon: ListFilter },
};

type FleetItem = { id: number; name: string };

export function AuditTrailView() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fleet, setFleet] = useState<FleetItem[]>([]);
  const [categories, setCategories] = useState<AuditCategory[]>([]);
  const [serverId, setServerId] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (categories.length) params.set("categories", categories.join(","));
    if (serverId) params.set("serverId", serverId);
    if (q.trim()) params.set("q", q.trim());
    if (from) params.set("from", String(new Date(from).getTime()));
    if (to) params.set("to", String(new Date(to).getTime()));
    return params;
  }, [categories, serverId, q, from, to]);

  const load = useCallback(
    async (nextOffset: number, append: boolean) => {
      setLoading(true);
      try {
        const params = new URLSearchParams(queryString);
        params.set("limit", String(limit));
        params.set("offset", String(nextOffset));
        const r = await fetch(`/api/audit?${params.toString()}`, { cache: "no-store" });
        const j = await r.json();
        if (r.ok) {
          setEvents((prev) => (append ? [...prev, ...j.events] : j.events));
          setTotal(j.total);
          setOffset(nextOffset);
        }
      } catch {} finally {
        setLoading(false);
      }
    },
    [queryString]
  );

  useEffect(() => {
    void load(0, false);
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/servers", { cache: "no-store" });
        const j = await r.json();
        if (j.servers) setFleet(j.servers.map((s: { id: number; name: string }) => ({ id: s.id, name: s.name })));
      } catch {}
    })();
  }, []);

  function toggleCategory(category: AuditCategory) {
    setCategories((prev) => (prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]));
  }

  return (
    <div className="panel p-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="font-display flex items-center gap-2 text-[15px] font-bold text-plum-900">
          <ScrollText size={16} className="text-candy-500" /> Audit trail
        </h3>
        <a
          href={`/api/audit/export?${queryString.toString()}`}
          className="flex items-center gap-1.5 rounded-xl border border-candy-200 px-3 py-1.5 text-[12px] font-semibold text-plum-700 hover:bg-candy-50"
        >
          <Download size={13} /> Download CSV
        </a>
      </div>
      <p className="mb-4 text-[12px] text-plum-500">
        Everything that happened, in one timeline: power actions, file edits with their safety copies, backups and exports, roster
        changes, task runs, and PIN unlock attempts.
      </p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {AUDIT_CATEGORIES.map((category) => {
          const meta = CATEGORY_META[category];
          const active = categories.length === 0 || categories.includes(category);
          return (
            <button
              key={category}
              onClick={() => toggleCategory(category)}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition ${
                categories.includes(category) ? "border-transparent text-white" : "border-candy-200 text-plum-600 hover:bg-candy-50"
              }`}
              style={categories.includes(category) ? { backgroundColor: meta.color } : active ? {} : { opacity: 0.5 }}
            >
              <meta.icon size={12} /> {meta.label}
            </button>
          );
        })}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search summary, detail, server…" className={inputCls + " max-w-[260px]"} />
        <select value={serverId} onChange={(e) => setServerId(e.target.value)} className={inputCls + " w-auto"}>
          <option value="">All servers</option>
          {fleet.map((server) => (
            <option key={server.id} value={server.id}>{server.name}</option>
          ))}
        </select>
        <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls + " w-auto"} title="From" />
        <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls + " w-auto"} title="To" />
        <span className="ml-auto text-[12px] text-plum-400">{total} event{total === 1 ? "" : "s"}</span>
      </div>
      {loading && events.length === 0 ? (
        <Spin label="Loading audit trail…" />
      ) : events.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-plum-400">No events match these filters.</p>
      ) : (
        <div className="space-y-1.5">
          {events.map((event, index) => {
            const meta = CATEGORY_META[event.category] ?? CATEGORY_META.other;
            return (
              <div key={`${event.at}-${index}`} className="flex items-start gap-3 rounded-xl border border-candy-100 px-3.5 py-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${meta.color}22`, color: meta.color }}>
                  <meta.icon size={13} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-semibold text-plum-800">{event.summary}</div>
                  <div className="text-[11.5px] text-plum-400">
                    {event.serverName} · {meta.label}
                    {event.detail && event.detail !== event.category ? ` · ${event.detail}` : ""}
                  </div>
                </div>
                <span className="shrink-0 text-[11.5px] text-plum-400" title={new Date(event.at).toLocaleString()}>
                  {timeAgo(event.at)}
                </span>
              </div>
            );
          })}
          {offset + limit < total ? (
            <div className="pt-2 text-center">
              <Btn onClick={() => void load(offset + limit, true)} disabled={loading}>
                {loading ? <RefreshCw size={14} className="animate-spin" /> : null} Load older events
              </Btn>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

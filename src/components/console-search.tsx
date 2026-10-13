"use client";

import { AlertTriangle, ChevronDown, ChevronRight, Download, Search } from "lucide-react";
import { useState } from "react";
import { Btn, Spin, inputCls } from "./ui";

const LEVELS = ["info", "warn", "error", "command", "system"] as const;
type Line = { id: number; ts: string; level: string; source: string; message: string };

const LEVEL_COLORS: Record<string, string> = {
  error: "text-rose-600",
  warn: "text-amber-600",
  command: "text-sky-600",
  system: "text-plum-500",
  info: "text-plum-700",
};

export function ConsoleSearch({ serverId, accent }: { serverId: number; accent: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [regex, setRegex] = useState(false);
  const [levels, setLevels] = useState<Set<string>>(new Set());
  const [source, setSource] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [lines, setLines] = useState<Line[] | null>(null);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [scanTruncated, setScanTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function queryString(extra: Record<string, string> = {}) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (regex) params.set("regex", "1");
    if (levels.size > 0) params.set("levels", [...levels].join(","));
    if (source) params.set("source", source);
    if (from) params.set("from", String(new Date(from).getTime()));
    if (to) params.set("to", String(new Date(to).getTime()));
    for (const [key, value] of Object.entries(extra)) params.set(key, value);
    return params.toString();
  }

  async function search(cursor: number | null) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/servers/${serverId}/console/search?${queryString(cursor ? { cursor: String(cursor) } : {})}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ?? `Search failed (HTTP ${r.status})`);
        return;
      }
      setLines(cursor ? [...(lines ?? []), ...j.lines] : j.lines);
      setNextCursor(j.nextCursor);
      setScanTruncated(Boolean(j.scanTruncated));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel overflow-hidden">
      <button className="flex w-full items-center gap-2 px-4 py-3 text-left" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} className="text-plum-400" /> : <ChevronRight size={14} className="text-plum-400" />}
        <Search size={14} style={{ color: accent }} />
        <span className="font-display text-[13.5px] font-semibold text-plum-900">Search console history</span>
        <span className="text-[11px] text-plum-400">every stored line, across restarts</span>
      </button>
      {open && (
        <div className="border-t border-candy-200/70 p-4">
          <form
            className="flex flex-wrap items-center gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void search(null);
            }}
          >
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={regex ? "regex pattern…" : "text to find…"} className={`${inputCls} w-56 font-mono`} spellCheck={false} />
            <label className="flex items-center gap-1.5 text-[12px] text-plum-600">
              <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> regex
            </label>
            <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="source…" className={`${inputCls} w-28`} spellCheck={false} />
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputCls} w-auto`} />
            <span className="text-[11px] text-plum-400">to</span>
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputCls} w-auto`} />
            <Btn variant="primary" accent={accent} loading={busy && lines === null}>
              <Search size={13} /> Search
            </Btn>
            <a
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] font-semibold transition hover:bg-candy-100"
              style={{ color: accent }}
              href={`/api/servers/${serverId}/console/export?${queryString()}`}
              download
            >
              <Download size={13} /> Download .log
            </a>
          </form>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {LEVELS.map((level) => {
              const active = levels.has(level);
              return (
                <button
                  key={level}
                  onClick={() =>
                    setLevels((prev) => {
                      const next = new Set(prev);
                      if (next.has(level)) next.delete(level);
                      else next.add(level);
                      return next;
                    })
                  }
                  className={`rounded-md px-2 py-1 text-[10.5px] font-bold uppercase tracking-wider transition ${active ? "text-white" : "bg-candy-50 text-plum-500 hover:bg-candy-100"}`}
                  style={active ? { background: accent } : undefined}
                >
                  {level}
                </button>
              );
            })}
            <span className="text-[10.5px] text-plum-400">{levels.size === 0 ? "all levels" : `${levels.size} selected`}</span>
          </div>
          {error && (
            <div className="mt-3 flex items-center gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-[12px] text-rose-600">
              <AlertTriangle size={12} /> {error}
            </div>
          )}
          {busy && lines === null ? (
            <div className="mt-3">
              <Spin label="Searching…" />
            </div>
          ) : lines !== null ? (
            <div className="mt-3">
              <p className="mb-1.5 text-[11px] text-plum-400">
                {lines.length} match{lines.length === 1 ? "" : "es"}
                {scanTruncated ? " (large history — continue below to scan further)" : nextCursor === null ? " — end of history" : ""}
              </p>
              <div className="max-h-[360px] overflow-auto rounded-xl border border-candy-200/70 bg-candy-50 p-3 font-mono text-[11.5px] leading-[1.7]">
                {lines.length === 0 && <p className="text-plum-400">No matching lines.</p>}
                {lines.map((line) => (
                  <div key={line.id} className="whitespace-pre-wrap">
                    <span className="text-plum-400">{new Date(line.ts).toLocaleString()} </span>
                    <span className={LEVEL_COLORS[line.level] ?? "text-plum-700"}>[{line.level}] </span>
                    <span className="text-plum-500">[{line.source}] </span>
                    <span className="text-plum-800">{line.message}</span>
                  </div>
                ))}
              </div>
              {nextCursor !== null && (
                <div className="mt-2">
                  <Btn size="sm" variant="subtle" onClick={() => void search(nextCursor)} loading={busy}>
                    Continue searching older lines
                  </Btn>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

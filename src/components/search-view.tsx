"use client";

import { Archive, Boxes, ScrollText, Search, Users } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { matchRange, type SearchHit, type SearchHitType } from "@/lib/fleet-search";
import { timeAgo } from "@/lib/format";
import { Spin, inputCls } from "./ui";

type Results = Record<"servers" | "players" | "backups" | "activity", SearchHit[]>;

const GROUPS: { key: keyof Results; label: string; icon: typeof Boxes }[] = [
  { key: "servers", label: "Servers", icon: Boxes },
  { key: "players", label: "Players", icon: Users },
  { key: "backups", label: "Backups", icon: Archive },
  { key: "activity", label: "Activity", icon: ScrollText },
];

function Highlight({ query, text }: { query: string; text: string }) {
  const range = matchRange(query, text);
  if (!range) return <>{text}</>;
  const [start, end] = range;
  return (
    <>
      {text.slice(0, start)}
      <mark className="rounded bg-candy-100 px-0.5 text-inherit">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

export function SearchView() {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [data, setData] = useState<{ query: string; results: Results; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (q.length < 2) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        const j = await r.json();
        if (j.results) setData(j);
        router.replace(`/search?q=${encodeURIComponent(q)}`);
      } catch {
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="panel p-5">
        <div className="mb-3 flex items-center gap-2">
          <Search size={16} className="text-candy-500" />
          <h1 className="font-display text-lg font-bold tracking-tight text-plum-900">Fleet search</h1>
        </div>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search servers, players, backups, and activity…"
          className={inputCls}
        />
        <p className="mt-2 text-[11px] text-plum-400">
          One box for the whole fleet — server names, games, ports, player names and notes, backup names, and the activity feed.
        </p>
      </div>

      {loading && <Spin label="Searching the fleet…" />}

      {!loading && data && data.total === 0 && (
        <div className="panel p-8 text-center text-sm text-plum-400">
          Nothing in the fleet matches <span className="font-semibold text-plum-600">“{data.query}”</span>.
        </div>
      )}

      {!loading && data && data.total > 0 && (
        <div className="space-y-4">
          {GROUPS.map(({ key, label, icon: Icon }) => {
            const hits = data.results[key];
            if (!hits || hits.length === 0) return null;
            return (
              <div key={key} className="panel p-4">
                <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-plum-500">
                  <Icon size={12} /> {label} <span className="text-plum-300">· {hits.length}</span>
                </p>
                <div className="space-y-1">
                  {hits.map((hit) => (
                    <Link
                      key={`${hit.type}-${hit.id}`}
                      href={hit.href}
                      className="flex items-center gap-2 rounded-xl border border-transparent px-2.5 py-2 text-sm transition hover:border-candy-100 hover:bg-candy-50"
                    >
                      <span className="min-w-0 truncate font-semibold text-plum-800">
                        <Highlight query={data.query} text={hit.title} />
                      </span>
                      <span className="min-w-0 truncate text-xs text-plum-400">{hit.subtitle}</span>
                      {hit.at > 0 && <span className="ml-auto shrink-0 text-[10.5px] text-plum-300">{timeAgo(hit.at)}</span>}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

"use client";

import { Globe2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn, timeAgo } from "@/lib/format";
import { formatBytes } from "@/lib/self-check";
import { Btn, Spin } from "./ui";

type World = { name: string; sizeBytes: number; lastModified: number; active: boolean };
type Payload = { worlds: World[]; activeWorld: string; activeExists: boolean; status: string };

export function WorldsPanel({ serverId, accent }: { serverId: number; accent: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/servers/${serverId}/worlds`, { cache: "no-store" });
    if (r.ok) setData((await r.json()) as Payload);
  }, [serverId]);
  useEffect(() => { void load(); }, [load]);

  async function activate(world: World) {
    setPending(`switch-${world.name}`);
    setNote(null);
    try {
      const r = await fetch(`/api/servers/${serverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worldName: world.name }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) setNote(j.error ?? "Could not switch worlds");
      else setNote(`"${world.name}" is now the active world — applies on the next start.`);
      await load();
    } finally {
      setPending(null);
    }
  }

  async function remove(world: World) {
    if (!window.confirm(`Delete the world "${world.name}" and all its data? This cannot be undone.`)) return;
    setPending(`delete-${world.name}`);
    setNote(null);
    try {
      const r = await fetch(`/api/servers/${serverId}/worlds`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: world.name }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) setNote(j.error ?? "Could not delete the world");
      await load();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="panel p-5">
      <div className="mb-1 flex items-center gap-2">
        <Globe2 size={15} style={{ color: accent }} />
        <h3 className="font-display text-[13.5px] font-semibold text-plum-900">Worlds</h3>
      </div>
      <p className="mb-3 text-[12px] text-plum-500">
        World folders found in the server directory. Switching takes effect on the next start; take a backup before
        deleting anything.
      </p>
      {!data ? (
        <Spin />
      ) : data.worlds.length === 0 ? (
        <p className="text-[12.5px] text-plum-500">
          No world folders yet{data.activeWorld ? <> — &quot;{data.activeWorld}&quot; will be created on first start.</> : "."}
        </p>
      ) : (
        <ul className="space-y-2">
          {data.worlds.map((world) => (
            <li key={world.name} className={cn("flex flex-wrap items-center gap-3 rounded-xl px-4 py-2.5", world.active ? "bg-emerald-50/70" : "bg-candy-50/60")}>
              <div className="mr-auto min-w-0">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-plum-900">
                  <span className="truncate">{world.name}</span>
                  {world.active && <span className="rounded bg-emerald-100 px-1.5 py-px text-[10px] font-bold uppercase text-emerald-700">active</span>}
                </p>
                <p className="text-[11.5px] text-plum-500">
                  {formatBytes(world.sizeBytes)}{world.lastModified > 0 ? <> · last played {timeAgo(world.lastModified)}</> : null}
                </p>
              </div>
              {!world.active && (
                <>
                  <Btn size="sm" variant="outline" accent={accent} loading={pending === `switch-${world.name}`} onClick={() => void activate(world)}>
                    Make active
                  </Btn>
                  <button
                    type="button"
                    className="text-plum-400 hover:text-red-600 disabled:opacity-40"
                    disabled={pending === `delete-${world.name}`}
                    onClick={() => void remove(world)}
                    aria-label={`Delete world ${world.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {note && <p className="mt-3 text-[12px] font-semibold text-plum-700">{note}</p>}
    </div>
  );
}

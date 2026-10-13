"use client";

import { Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Spin, Toggle, inputCls } from "./ui";

type Maintenance = { enabled: boolean; note: string; since: string | null };

export function MaintenancePanel({ serverId, accent }: { serverId: number; accent: string }) {
  const [maintenance, setMaintenance] = useState<Maintenance | null>(null);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/servers/${serverId}/maintenance`, { cache: "no-store" });
      const j = await r.json();
      setMaintenance(j.maintenance);
      setNote(j.maintenance?.note ?? "");
    } catch {
      setMaintenance({ enabled: false, note: "", since: null });
    }
  }, [serverId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(t);
  }, [notice]);

  if (!maintenance) return <Spin label="Loading maintenance mode…" />;

  async function save(enabled: boolean, nextNote: string) {
    try {
      const r = await fetch(`/api/servers/${serverId}/maintenance`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, note: nextNote }),
      });
      const j = await r.json();
      if (r.ok) {
        setMaintenance(j.maintenance);
        setNote(j.maintenance.note);
        setNotice({ text: j.maintenance.enabled ? "Maintenance mode ON — automation paused" : "Maintenance mode off", ok: true });
      } else {
        setNotice({ text: j.error ?? "Save failed", ok: false });
      }
    } catch {
      setNotice({ text: "Save failed", ok: false });
    }
  }

  return (
    <div className="panel p-5">
      <div className="mb-1 flex items-center gap-2">
        <Wrench size={15} style={{ color: accent }} />
        <h3 className="font-display text-[13.5px] font-semibold text-plum-900">Maintenance mode</h3>
      </div>
      <p className="mb-3 text-[12px] text-plum-500">
        Pauses everything automated for this server — scheduled tasks, crash auto-restarts, and announcements — and shows
        “maintenance” on the public status page. Manual actions keep working; paused tasks fire once the flag is lifted.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Toggle checked={maintenance.enabled} onChange={(v) => void save(v, note)} />
          <span className="text-[12px] font-semibold text-plum-600">{maintenance.enabled ? "ON — automation paused" : "Off"}</span>
        </div>
        <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-plum-600">
          note
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => { if (maintenance.enabled && note !== maintenance.note) void save(true, note); }}
            placeholder="optional — e.g. upgrading mods"
            maxLength={200}
            className={`${inputCls} min-w-0 flex-1`}
          />
        </label>
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-plum-400">
        {maintenance.enabled && maintenance.since && <span>In maintenance since {new Date(maintenance.since).toLocaleString()}</span>}
        {notice && <span className={`text-[12px] font-semibold ${notice.ok ? "text-emerald-600" : "text-rose-500"}`}>{notice.text}</span>}
      </div>
    </div>
  );
}

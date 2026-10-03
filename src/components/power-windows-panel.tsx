"use client";

import { CalendarClock, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Btn, Spin, Toggle, inputCls } from "./ui";

type PowerWindow = { days: number[]; start: string; end: string };
type Schedule = { enabled: boolean; windows: PowerWindow[] };

const MAX_WINDOWS = 4;
// Display Monday-first; values keep JavaScript's getDay numbering (0 = Sunday).
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LABELS: Record<number, string> = { 0: "Su", 1: "Mo", 2: "Tu", 3: "We", 4: "Th", 5: "Fr", 6: "Sa" };

export function PowerWindowsPanel({ serverId, accent }: { serverId: number; accent: string }) {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [desired, setDesired] = useState<string | null>(null);
  const [nextTransition, setNextTransition] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/servers/${serverId}/power-windows`, { cache: "no-store" });
      const j = await r.json();
      if (j.schedule) {
        setSchedule(j.schedule);
        setDesired(j.desired ?? null);
        setNextTransition(j.nextTransition ?? null);
      }
    } catch {
      setSchedule({ enabled: false, windows: [] });
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

  if (!schedule) return <Spin label="Loading power schedule…" />;

  function patch(next: Partial<Schedule>) {
    setSchedule((prev) => (prev ? { ...prev, ...next } : prev));
  }

  function patchWindow(index: number, next: Partial<PowerWindow>) {
    setSchedule((prev) => {
      if (!prev) return prev;
      const windows = prev.windows.map((w, i) => (i === index ? { ...w, ...next } : w));
      return { ...prev, windows };
    });
  }

  function toggleDay(index: number, day: number) {
    const w = schedule!.windows[index];
    const days = w.days.includes(day) ? w.days.filter((d) => d !== day) : [...w.days, day];
    patchWindow(index, { days });
  }

  async function save() {
    setSaving(true);
    try {
      const r = await fetch(`/api/servers/${serverId}/power-windows`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(schedule),
      });
      const j = await r.json();
      if (r.ok) {
        setSchedule(j.schedule);
        setDesired(j.desired ?? null);
        setNextTransition(j.nextTransition ?? null);
        setNotice({ text: j.schedule.enabled ? "Power schedule saved ✓" : "Power schedule saved (off)", ok: true });
      } else {
        setNotice({ text: j.error ?? "Save failed", ok: false });
      }
    } catch {
      setNotice({ text: "Save failed", ok: false });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel p-5">
      <div className="mb-1 flex items-center gap-2">
        <CalendarClock size={15} style={{ color: accent }} />
        <p className="text-sm font-semibold text-plum-800">Weekly power schedule</p>
      </div>
      <p className="mb-3 text-xs text-plum-500">
        Keep this server online only inside the windows below — it starts when a window opens and stops when it closes.
        The scheduler acts at the edges; manual power controls always win in between, and maintenance mode pauses it.
      </p>
      <label className="mb-3 flex items-center gap-2 text-xs font-medium text-plum-600">
        <Toggle checked={schedule.enabled} onChange={(v) => patch({ enabled: v })} accent={accent} disabled={schedule.windows.length === 0} />
        Enforce this schedule
      </label>
      <div className="space-y-2">
        {schedule.windows.map((w, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2 rounded-xl border border-candy-100 p-2.5">
            <div className="flex gap-1">
              {DAY_ORDER.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(index, day)}
                  className={`h-7 w-8 rounded-lg text-[10px] font-bold transition ${w.days.includes(day) ? "text-white" : "bg-candy-50 text-plum-400 hover:text-plum-600"}`}
                  style={w.days.includes(day) ? { background: accent } : undefined}
                >
                  {DAY_LABELS[day]}
                </button>
              ))}
            </div>
            <input type="time" value={w.start} onChange={(e) => patchWindow(index, { start: e.target.value })} className={`${inputCls} !w-auto`} />
            <span className="text-xs text-plum-400">to</span>
            <input type="time" value={w.end} onChange={(e) => patchWindow(index, { end: e.target.value })} className={`${inputCls} !w-auto`} />
            <button
              type="button"
              aria-label="Remove window"
              onClick={() => patch({ windows: schedule.windows.filter((_, i) => i !== index) })}
              className="ml-auto rounded-lg p-1.5 text-plum-400 transition hover:bg-red-50 hover:text-red-500"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {schedule.windows.length < MAX_WINDOWS && (
          <Btn
            variant="ghost"
            onClick={() => patch({ windows: [...schedule.windows, { days: [1, 2, 3, 4, 5], start: "16:00", end: "23:00" }] })}
          >
            <Plus size={14} /> Add window
          </Btn>
        )}
        <Btn variant="subtle" loading={saving} onClick={save}>
          Save schedule
        </Btn>
        {notice && (
          <span className={`text-[12px] font-semibold ${notice.ok ? "text-emerald-600" : "text-rose-500"}`}>{notice.text}</span>
        )}
      </div>
      {schedule.enabled && desired && (
        <p className="mt-2 text-[11px] text-plum-400">
          Right now the schedule wants this server <span className="font-semibold text-plum-600">{desired}</span>
          {nextTransition ? ` — next change ${new Date(nextTransition).toLocaleString()}` : ""}.
        </p>
      )}
    </div>
  );
}

"use client";

import { CalendarClock, DatabaseBackup, DownloadCloud, ListChecks, Megaphone, Pencil, Play, Plus, Power, RotateCw, Terminal, Timer, Trash2, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import type { Task, TaskRun } from "@/db/schema";
import { cn, hexA, timeAgo } from "@/lib/format";
import { Btn, Empty, Field, Modal, Spin, Toggle, inputCls } from "./ui";

const TYPE_META: Record<string, { label: string; icon: React.ComponentType<{ size?: number | string; className?: string }>; color: string; hint: string }> = {
  maintenance: { label: "Maintenance", icon: Wrench, color: "#fb7185", hint: "Backup, stop and update safely" },
  update: { label: "Game update", icon: DownloadCloud, color: "#34d399", hint: "Checks first — updates only when a new build is published" },
  restart: { label: "Restart", icon: RotateCw, color: "#f5b84c", hint: "Gracefully restarts the server" },
  backup: { label: "Backup", icon: DatabaseBackup, color: "#38bdf8", hint: "Creates a world snapshot" },
  prune: { label: "Prune backups", icon: Trash2, color: "#f97316", hint: "Applies the backup retention limits" },
  command: { label: "Command", icon: Terminal, color: "#c084fc", hint: "Runs a console command" },
  broadcast: { label: "Broadcast", icon: Megaphone, color: "#4ade80", hint: "Sends a message to chat" },
  macro: { label: "Macro", icon: ListChecks, color: "#818cf8", hint: "Runs a saved command sequence" },
  start: { label: "Start server", icon: Play, color: "#22c55e", hint: "Starts the server if it is offline" },
  stop: { label: "Stop server", icon: Power, color: "#ef4444", hint: "Stops the server gracefully if it is running" },
};

const INTERVALS = [
  { label: "15 min", min: 15 },
  { label: "30 min", min: 30 },
  { label: "1 hour", min: 60 },
  { label: "2 hours", min: 120 },
  { label: "6 hours", min: 360 },
  { label: "12 hours", min: 720 },
  { label: "daily", min: 1440 },
  { label: "weekly", min: 10080 },
];

function inTime(d: string | Date | null): string {
  if (!d) return "—";
  const ms = new Date(d).getTime() - Date.now();
  if (ms <= 0) return "due now";
  const min = Math.round(ms / 60000);
  if (min < 60) return `in ${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `in ${h}h ${min % 60}m`;
  return `in ${Math.round(h / 24)}d`;
}

function localDateTime(value:string|Date){const date=new Date(value),pad=(n:number)=>String(n).padStart(2,"0");return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`}

function fmtInterval(min: number) {
  return INTERVALS.find((i) => i.min === min)?.label ?? `${min}m`;
}

export function TasksManager({ serverId, accent }: { serverId: number; accent: string }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [runs,setRuns]=useState<TaskRun[]>([]);
  const [historyFilter,setHistoryFilter]=useState<"all"|"succeeded"|"failed"|"skipped">("all");
  const [editing,setEditing]=useState<Task|null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", type: "backup", payload: "", intervalMin: 360, scheduleKind: "interval", scheduledFor: "", scheduleTime: "09:00", scheduleWeekday: 1, missedPolicy: "run" });
  const [macros, setMacros] = useState<Array<{ id: string; name: string; steps: Array<{ command: string; delaySec: number }> }>>([]);
  const [windowOpen, setWindowOpen] = useState(false);
  const [windowStart, setWindowStart] = useState("15:00");
  const [windowStop, setWindowStop] = useState("23:00");
  const [windowErr, setWindowErr] = useState("");

  async function createWindow() {
    setWindowErr("");
    if (!windowStart || !windowStop) return setWindowErr("Pick both times.");
    if (windowStart === windowStop) return setWindowErr("Start and stop times must differ.");
    setBusy(true);
    try {
      for (const task of [
        { name: `Power on at ${windowStart}`, type: "start", scheduleKind: "daily", scheduleTime: windowStart, missedPolicy: "run" },
        { name: `Power off at ${windowStop}`, type: "stop", scheduleKind: "daily", scheduleTime: windowStop, missedPolicy: "run" },
      ]) {
        const r = await fetch(`/api/servers/${serverId}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...task, payload: "", confirmedCommand: "" }) });
        if (!r.ok) { const j = await r.json(); return setWindowErr(j.error ?? "Could not create the power window"); }
      }
      setWindowOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    try {
      const r = await fetch(`/api/servers/${serverId}/tasks`, { cache: "no-store" });
      const j = await r.json();
      if (j.tasks) setTasks(j.tasks);
      if (j.runs) setRuns(j.runs);
      const m = await fetch(`/api/servers/${serverId}/macros`, { cache: "no-store" }).then((res) => res.json());
      if (m.macros) setMacros(m.macros);
    } catch {}
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(editing?`/api/servers/${serverId}/tasks/${editing.id}`:`/api/servers/${serverId}/tasks`, {
        method: editing?"PATCH":"POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({...form,confirmedCommand:form.type==="broadcast"?`say ${form.payload.trim()}`:form.type==="command"?form.payload.trim():form.type==="macro"?(macros.find(m=>m.id===form.payload)?.steps.map(s=>s.command).join("\n")??""):""}),
      });
      const j = await r.json();
      if (!r.ok) return setErr(j.error ?? "Failed");
      setOpen(false);
      setEditing(null);
      setForm({ name: "", type: "backup", payload: "", intervalMin: 360, scheduleKind: "interval", scheduledFor: "", scheduleTime: "09:00", scheduleWeekday: 1, missedPolicy: "run" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function pruneHistory(){if(!window.confirm("Delete scheduled action history older than 30 days?"))return;setBusy(true);try{await fetch(`/api/servers/${serverId}/tasks?olderThanDays=30`,{method:"DELETE"});await load()}finally{setBusy(false)}}
  async function retryRun(run:TaskRun){setBusy(true);try{const response=await fetch(`/api/servers/${serverId}/tasks/runs/${run.id}`,{method:"POST"});const body=await response.json();if(!response.ok)setErr(body.error??"Retry failed");await load()}finally{setBusy(false)}}

  async function toggle(t: Task) {
    await fetch(`/api/servers/${serverId}/tasks/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !t.enabled }),
    });
    await load();
  }

  async function runNow(t: Task) {
    await fetch(`/api/servers/${serverId}/tasks/${t.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "run" }),
    });
    await load();
  }

  async function remove(t: Task) {
    await fetch(`/api/servers/${serverId}/tasks/${t.id}`, { method: "DELETE" });
    await load();
  }

  if (!tasks) return <Spin label="Loading schedules…" />;

  const needsPayload = form.type === "command" || form.type === "broadcast";

  return (
    <div className="space-y-5">
      <div className="panel flex items-center gap-3 p-4 sm:p-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: hexA(accent, 0.1), color: accent }}>
          <CalendarClock size={18} />
        </span>
        <div className="mr-auto">
          <p className="font-display text-[15px] font-semibold text-plum-900">Scheduler</p>
          <p className="text-[12px] text-plum-500">{tasks.filter((t) => t.enabled).length} active · runs even while you sleep</p>
        </div>
        <Btn variant="subtle" onClick={() => setWindowOpen(true)} title="Create a daily start/stop pair so the server only runs while people play">
          <Timer size={14} /> Power window
        </Btn>
        <Btn variant="primary" accent={accent} onClick={() => {setEditing(null);setOpen(true)}}>
          <Plus size={15} /> New task
        </Btn>
      </div>

      <Modal open={windowOpen} onClose={() => setWindowOpen(false)} title="Daily power window">
        <p className="text-[13px] text-plum-500">Creates two daily tasks: start the server at the first time, stop it at the second. Overnight windows (stop after midnight) work too.</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Start at"><input className={inputCls} type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} /></Field>
          <Field label="Stop at"><input className={inputCls} type="time" value={windowStop} onChange={(e) => setWindowStop(e.target.value)} /></Field>
        </div>
        {windowErr && <p className="mt-3 text-xs text-red-500">{windowErr}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setWindowOpen(false)}>Cancel</Btn>
          <Btn variant="primary" accent={accent} loading={busy} onClick={() => void createWindow()}><Timer size={14} /> Create both tasks</Btn>
        </div>
      </Modal>

      {tasks.length === 0 ? (
        <Empty icon={<CalendarClock size={22} />} title="Nothing scheduled" hint="Automate restarts, backups and announcements on a repeating interval." />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {tasks.map((t) => {
            const meta = TYPE_META[t.type] ?? TYPE_META.command;
            const Icon = meta.icon;
            return (
              <div key={t.id} className={cn("panel p-4 transition", !t.enabled && "opacity-60")}>
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: hexA(meta.color, 0.1), color: meta.color }}>
                    <Icon size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[14px] font-semibold text-plum-900">{t.name}</p>
                      <span className="rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider" style={{ background: hexA(meta.color, 0.12), color: meta.color }}>
                        {meta.label}
                      </span>
                    </div>
                    {t.payload && <p className="mt-0.5 truncate font-mono text-[11px] text-plum-500">“{t.payload}”</p>}
                    <p className="mt-1.5 text-[11.5px] text-plum-500">
                      {t.scheduleKind === "once" ? "one time" : t.scheduleKind === "daily" ? `daily at ${t.scheduleTime}` : t.scheduleKind === "weekly" ? `weekly at ${t.scheduleTime}` : `every ${fmtInterval(t.intervalMin)}`} · next <span className="font-medium text-plum-700">{t.enabled ? inTime(t.nextRunAt) : t.scheduleKind === "once" && t.lastRunAt ? "completed" : "paused"}</span>
                      {t.lastRunAt ? ` · last ${timeAgo(t.lastRunAt)}` : " · never run"}
                    </p>
                  </div>
                  <Toggle checked={t.enabled} onChange={() => toggle(t)} accent={accent} />
                </div>
                <div className="mt-3 flex justify-end gap-1.5 border-t border-candy-200/60 pt-2.5">
                  <button onClick={()=>{setEditing(t);setForm({name:t.name,type:t.type,payload:t.payload,intervalMin:t.intervalMin,scheduleKind:t.scheduleKind,scheduledFor:t.scheduleKind==="once"&&t.nextRunAt?localDateTime(t.nextRunAt):"",scheduleTime:t.scheduleTime,scheduleWeekday:t.scheduleWeekday,missedPolicy:t.missedPolicy});setOpen(true)}} className="flex items-center gap-1.5 rounded-lg border border-candy-200 bg-candy-50 px-2.5 py-1.5 text-[11px] font-semibold text-plum-700"><Pencil size={11}/> Edit</button>
                  <button
                    onClick={() => runNow(t)}
                    className="flex items-center gap-1.5 rounded-lg border border-candy-200 bg-candy-50 px-2.5 py-1.5 text-[11px] font-semibold text-plum-700 transition hover:bg-candy-100"
                  >
                    <Play size={11} /> Run now
                  </button>
                  <button
                    onClick={() => remove(t)}
                    className="flex items-center gap-1.5 rounded-lg border border-candy-200 bg-candy-50 px-2.5 py-1.5 text-[11px] font-semibold text-plum-500 transition hover:border-red-300 hover:text-red-500"
                  >
                    <Trash2 size={11} /> Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {runs.length>0&&<section className="panel p-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-display text-sm font-semibold text-plum-900">Scheduled action history</h3><div className="flex gap-1">{(["all","succeeded","failed","skipped"] as const).map(filter=><button key={filter} onClick={()=>setHistoryFilter(filter)} className={cn("rounded-lg px-2 py-1 text-[10px] font-bold uppercase",historyFilter===filter?"bg-candy-100 text-plum-800":"text-plum-400")}>{filter}</button>)}<button onClick={()=>void pruneHistory()} className="rounded-lg px-2 py-1 text-[10px] font-bold uppercase text-red-500">Prune 30d+</button></div></div><div className="max-h-72 space-y-2 overflow-auto">{runs.filter(run=>historyFilter==="all"||(historyFilter==="skipped"&&["skipped","rescheduled"].includes(run.status))||run.status===historyFilter).slice(0,30).map(run=><div key={run.id} className="rounded-xl border border-candy-100 px-3 py-2 text-xs"><div className="flex justify-between gap-2"><strong>{run.taskName}</strong><span className={run.status==="succeeded"?"text-emerald-600":["skipped","rescheduled"].includes(run.status)?"text-amber-600":"text-red-500"}>{run.status}</span></div>{run.command&&<code className="mt-1 block text-[10px] text-plum-500">{run.command}</code>}{run.error&&<p className="mt-1 text-[10px] text-red-500">{run.error}</p>}<div className="mt-1 flex items-center justify-between"><p className="text-[10px] text-plum-400">{timeAgo(run.createdAt)}{run.retryOfRunId?` · retry of #${run.retryOfRunId}`:""}</p>{run.status==="failed"&&<Btn size="sm" variant="subtle" loading={busy} onClick={()=>void retryRun(run)}>Retry</Btn>}</div></div>)}</div></section>}
      <Modal open={open} onClose={() => setOpen(false)} title={editing?"Edit scheduled task":"New scheduled task"}>
        <div className="space-y-4">
          <Field label="Task name">
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nightly backup" maxLength={48} />
          </Field>
          <Field label="Action">
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(TYPE_META).map(([k, m]) => (
                <button
                  key={k}
                  onClick={() => setForm({ ...form, type: k })}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition",
                    form.type === k ? "border-transparent text-plum-900" : "border-candy-200 text-plum-500 hover:border-candy-300"
                  )}
                  style={form.type === k ? { background: hexA(m.color, 0.1), borderColor: hexA(m.color, 0.5) } : undefined}
                >
                  <m.icon size={15} className={form.type === k ? "" : "text-plum-500" } />
                  <span>
                    <span className="block text-[12.5px] font-semibold">{m.label}</span>
                    <span className="block text-[10px] text-plum-500">{m.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </Field>
          {needsPayload && (
            <Field label={form.type === "command" ? "Console command" : "Broadcast message"}>
              <input
                className={cn(inputCls, "font-mono")}
                value={form.payload}
                onChange={(e) => setForm({ ...form, payload: e.target.value })}
                placeholder={form.type === "command" ? "say Server restarting soon!" : "Build contest this weekend!"}
                maxLength={120}
              />
            </Field>
          )}
          {needsPayload&&form.payload.trim()&&<div className="rounded-xl border border-candy-200 bg-plum-900 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-candy-200">Exact command preview</p><code className="mt-1 block break-all text-xs text-white">{form.type==="broadcast"?`say ${form.payload.trim()}`:form.payload.trim()}</code></div>}
          {form.type === "macro" && (
            <Field label="Macro">
              {macros.length === 0 ? (
                <p className="text-xs text-plum-500">No macros yet — create one on the Console tab first.</p>
              ) : (
                <select className={inputCls} value={form.payload} onChange={(e) => setForm({ ...form, payload: e.target.value })}>
                  <option value="">Pick a macro…</option>
                  {macros.map((m) => (
                    <option key={m.id} value={m.id} className="bg-white">{m.name} ({m.steps.length} steps)</option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {form.type === "macro" && form.payload && macros.find((m) => m.id === form.payload) && (
            <div className="rounded-xl border border-candy-200 bg-plum-900 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-candy-200">Exact commands that will run</p>
              {macros.find((m) => m.id === form.payload)!.steps.map((s, i) => (
                <code key={i} className="mt-1 block break-all text-xs text-white">{s.command}{s.delaySec ? <span className="text-candy-200"> · then wait {s.delaySec}s</span> : null}</code>
              ))}
            </div>
          )}
          <Field label="Schedule"><div className="grid grid-cols-2 gap-2"><button className={cn("rounded-xl border p-2 text-xs font-semibold",form.scheduleKind==="interval"?"border-candy-400 bg-candy-50":"border-candy-200")} onClick={()=>setForm({...form,scheduleKind:"interval"})}>Recurring interval</button><button className={cn("rounded-xl border p-2 text-xs font-semibold",form.scheduleKind==="once"?"border-candy-400 bg-candy-50":"border-candy-200")} onClick={()=>setForm({...form,scheduleKind:"once"})}>One-time action</button><button className={cn("rounded-xl border p-2 text-xs font-semibold",form.scheduleKind==="daily"?"border-candy-400 bg-candy-50":"border-candy-200")} onClick={()=>setForm({...form,scheduleKind:"daily"})}>Daily time</button><button className={cn("rounded-xl border p-2 text-xs font-semibold",form.scheduleKind==="weekly"?"border-candy-400 bg-candy-50":"border-candy-200")} onClick={()=>setForm({...form,scheduleKind:"weekly"})}>Weekly time</button></div></Field>
          {form.scheduleKind==="once"?<Field label="Run at"><input className={inputCls} type="datetime-local" value={form.scheduledFor} onChange={event=>setForm({...form,scheduledFor:event.target.value})}/></Field>:form.scheduleKind==="daily"||form.scheduleKind==="weekly"?<div className="grid grid-cols-2 gap-2">{form.scheduleKind==="weekly"&&<Field label="Weekday"><select className={inputCls} value={form.scheduleWeekday} onChange={event=>setForm({...form,scheduleWeekday:Number(event.target.value)})}>{["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((day,index)=><option key={day} value={index}>{day}</option>)}</select></Field>}<Field label="Local time"><input className={inputCls} type="time" value={form.scheduleTime} onChange={event=>setForm({...form,scheduleTime:event.target.value})}/></Field></div>:<Field label="Repeat every">
            <select className={inputCls} value={form.intervalMin} onChange={(e) => setForm({ ...form, intervalMin: Number(e.target.value) })}>
              {INTERVALS.map((i) => (
                <option key={i.min} value={i.min} className="bg-white">{i.label}</option>
              ))}
            </select>
          </Field>}
          <Field label="If a run was missed while offline"><select className={inputCls} value={form.missedPolicy} onChange={event=>setForm({...form,missedPolicy:event.target.value})}><option value="run">Run immediately</option><option value="skip">Skip and record it</option><option value="reschedule">Reschedule without running</option></select></Field>
          {err && <p className="text-[12px] text-red-500">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn variant="primary" accent={accent} onClick={create} loading={busy} disabled={!form.name.trim()}>
              <Plus size={14} /> {editing?"Save task":"Create task"}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}

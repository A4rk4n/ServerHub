"use client";

import { AlertCircle, CheckCircle2, Circle, Download, HardDrive, Loader2, RotateCw, Wrench, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn, hexA } from "@/lib/format";
import { Btn } from "./ui";

type InstallJob = {
  id: number;
  status: "queued" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled";
  phase: string;
  progress: number;
  bytesDone: number;
  bytesTotal: number;
  message: string;
  error: string;
  attempt: number;
  updatedAt: string | Date;
};

type InstallEvent = {
  id: number;
  level: string;
  phase: string;
  progress: number;
  message: string;
};

const ACTIVE = new Set(["queued", "running", "cancelling"]);

function bytes(value: number) {
  if (!value) return "";
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

function phaseLabel(phase: string) {
  return phase.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function InstallationProgress({ serverId, accent }: { serverId: number; accent: string }) {
  const [now, setNow] = useState(0);
  const [job, setJob] = useState<InstallJob | null>(null);
  const [events, setEvents] = useState<InstallEvent[]>([]);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/servers/${serverId}/installation`, { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { job: InstallJob | null; events: InstallEvent[] };
      setJob(data.job);
      setNow(new Date().getTime());
      setEvents(data.events ?? []);
    } catch {
      // The normal server poll will recover after brief local-service restarts.
    }
  }, [serverId]);

  const pollingFast = job ? ACTIVE.has(job.status) : false;
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), pollingFast ? 900 : 3500);
    return () => clearInterval(timer);
  }, [pollingFast, refresh]);

  async function act(action: "cancel" | "retry" | "repair") {
    if (acting) return;
    setActing(true);
    setActionError("");
    try {
      const response = await fetch(`/api/servers/${serverId}/installation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json()) as { reason?: string; error?: string };
      if (!response.ok) setActionError(data.reason ?? data.error ?? `Could not ${action} installation`);
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setActing(false);
    }
  }

  if (!job || job.status === "succeeded") return null;
  const active = ACTIVE.has(job.status);
  const stalled = active && now - new Date(job.updatedAt).getTime() > 120_000;
  const failed = job.status === "failed" || job.status === "cancelled";
  const transfer = job.bytesDone > 0
    ? job.bytesTotal > 0
      ? `${bytes(job.bytesDone)} / ${bytes(job.bytesTotal)}`
      : bytes(job.bytesDone)
    : "";

  return (
    <section
      className="panel overflow-hidden border"
      style={{ borderColor: failed ? "rgba(226,68,92,.28)" : hexA(accent, 0.28) }}
      aria-live="polite"
      aria-label="Installation progress"
    >
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
          style={{ color: failed ? "#e2445c" : accent, background: failed ? "#fff1f3" : hexA(accent, 0.1) }}
        >
          {failed ? <AlertCircle size={19} /> : job.phase === "downloading" ? <Download size={19} /> : <Loader2 size={19} className="animate-spin" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 className="font-display text-[15px] font-bold text-plum-900">
              {failed ? (job.status === "cancelled" ? "Installation cancelled" : "Installation needs attention") : phaseLabel(job.phase)}
            </h2>
            <span className="font-mono text-[10.5px] text-plum-400">job #{job.id} · attempt {job.attempt}</span>
          </div>
          <p className={cn("mt-0.5 text-[12.5px]", failed ? "text-red-500" : "text-plum-500")}>{job.error || (stalled ? "No installer progress for over two minutes. You can cancel, then Repair and retry." : job.message)}</p>
        </div>
        {active ? (
          <Btn variant="ghost" size="sm" onClick={() => void act("cancel")} loading={acting} disabled={job.status === "cancelling"}>
            <X size={13} /> {job.status === "cancelling" ? "Cancelling" : "Cancel"}
          </Btn>
        ) : (
          <div className="flex gap-2">
            <Btn variant="ghost" size="sm" onClick={() => void act("repair")} loading={acting}>
              <Wrench size={13} /> Repair and retry
            </Btn>
            <Btn variant="primary" size="sm" accent={accent} onClick={() => void act("retry")} loading={acting}>
              <RotateCw size={13} /> Retry
            </Btn>
          </div>
        )}
      </div>

      <div className="border-t border-candy-100 px-5 py-4">
        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-plum-500">
          <span>{job.message}</span>
          <span className="ml-3 shrink-0 font-mono text-plum-700">{transfer ? `${transfer} · ` : ""}{job.progress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-candy-100">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${job.progress}%`,
              background: failed ? "#e2445c" : `linear-gradient(90deg, ${hexA(accent, 0.72)}, ${accent})`,
              boxShadow: failed ? undefined : `0 0 14px ${hexA(accent, 0.45)}`,
            }}
          />
        </div>

        {events.length > 0 && (
          <div className="mt-4 grid gap-1.5 sm:grid-cols-2">
            {events.slice(-4).map((event) => (
              <div key={event.id} className="flex min-w-0 items-center gap-2 text-[11px] text-plum-500">
                {event.level === "success" ? (
                  <CheckCircle2 size={11} className="shrink-0 text-emerald-600" />
                ) : event.level === "error" ? (
                  <AlertCircle size={11} className="shrink-0 text-red-500" />
                ) : event.phase === "preflight" ? (
                  <HardDrive size={11} className="shrink-0 text-plum-400" />
                ) : (
                  <Circle size={7} className="shrink-0 text-plum-300" fill="currentColor" />
                )}
                <span className="truncate">{event.message}</span>
              </div>
            ))}
          </div>
        )}
        {actionError && <p className="mt-3 text-[11.5px] font-medium text-red-500">{actionError}</p>}
      </div>
    </section>
  );
}

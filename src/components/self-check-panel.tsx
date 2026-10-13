"use client";

import { HeartPulse } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/format";
import { Btn } from "./ui";

type Item = { id: string; label: string; status: "ok" | "warn" | "fail"; detail: string };
type Result = { items: Item[]; summary: { status: "ok" | "warn" | "fail"; ok: number; warn: number; fail: number }; checkedAt: string };

const CHIP: Record<Item["status"], string> = {
  ok: "bg-emerald-50 text-emerald-600",
  warn: "bg-amber-50 text-amber-700",
  fail: "bg-red-50 text-red-600",
};

export function SelfCheckPanel() {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/self-check", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setResult((await r.json()) as Result);
    } catch {
      setError("The system check did not complete — see the panel logs.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel p-5">
      <div className="mb-1 flex items-center gap-2">
        <HeartPulse size={15} className="text-plum-500" />
        <h3 className="font-display text-[13.5px] font-semibold text-plum-900">System check</h3>
        {result && (
          <span className={cn("rounded px-1.5 py-px text-[10px] font-bold uppercase", CHIP[result.summary.status])}>
            {result.summary.status === "ok" ? "healthy" : result.summary.status === "warn" ? `${result.summary.warn} warning${result.summary.warn === 1 ? "" : "s"}` : `${result.summary.fail} problem${result.summary.fail === 1 ? "" : "s"}`}
          </span>
        )}
      </div>
      <p className="mb-3 text-[12px] text-plum-500">
        Audits the panel&apos;s own house: database integrity and size, console-log backlog, settings-file validity, backup archives
        the database expects versus what is on disk, tracked mod files, and free space.
      </p>
      <div className="flex items-center gap-3">
        <Btn variant="subtle" loading={busy} onClick={() => void run()}>
          Run system check
        </Btn>
        {result && <span className="text-[11.5px] text-plum-400">Checked {new Date(result.checkedAt).toLocaleTimeString()}</span>}
        {error && <span className="text-[11.5px] font-semibold text-red-600">{error}</span>}
      </div>
      {result && (
        <ul className="mt-3 space-y-1.5">
          {result.items.map((item) => (
            <li key={item.id} className="flex items-start gap-2 rounded-lg bg-candy-50/60 px-3 py-2">
              <span className={cn("mt-px shrink-0 rounded px-1.5 py-px text-[10px] font-bold uppercase", CHIP[item.status])}>{item.status}</span>
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold text-plum-800">{item.label}</p>
                <p className="text-[11.5px] text-plum-500">{item.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

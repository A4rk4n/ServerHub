"use client";
import { AlertTriangle, CheckCircle2, ListChecks, RefreshCw, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Btn } from "./ui";

type PreflightCheck = { id: string; label: string; severity: "ok" | "warning" | "blocker"; detail: string };
type PreflightResult = { checks: PreflightCheck[]; canStart: boolean; blockers: string[]; warnings: string[]; checkedAt: string };

/** Pre-launch checklist: the same checks the runtime runs before every start. */
export function PreflightPanel({ serverId, accent }: { serverId: number; accent: string }) {
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/servers/${serverId}/preflight`, { cache: "no-store" });
      if (r.ok) setResult(await r.json());
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const summary = !result
    ? null
    : !result.canStart
      ? { cls: "bg-red-50 text-red-600", text: "Start is blocked" }
      : result.warnings.length > 0
        ? { cls: "bg-amber-50 text-amber-600", text: `Ready with ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}` }
        : { cls: "bg-emerald-50 text-emerald-600", text: "Ready to start" };

  return (
    <section className="panel p-5">
      <div className="flex items-center">
        <div>
          <h2 className="font-display flex items-center gap-2 text-lg font-bold">
            <ListChecks size={18} style={{ color: accent }} />
            Pre-launch checks
          </h2>
          <p className="mt-1 text-xs text-plum-500">
            Run before every start — manual, scheduled, or crash restart. Blockers stop the launch; warnings are logged to the console but never stop anything.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {summary && <span className={`rounded-full px-3 py-1 text-xs font-semibold ${summary.cls}`}>{summary.text}</span>}
          <Btn variant="subtle" loading={loading} onClick={refresh}>
            <RefreshCw size={14} />
            Run checks
          </Btn>
        </div>
      </div>
      {result && (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {result.checks.map((check) => (
            <div key={check.id} className="flex gap-2 rounded-xl border border-candy-100 p-3">
              {check.severity === "ok" && <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />}
              {check.severity === "warning" && <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />}
              {check.severity === "blocker" && <XCircle size={16} className="mt-0.5 shrink-0 text-red-500" />}
              <div>
                <p className="text-sm font-medium text-plum-800">{check.label}</p>
                <p className="mt-1 text-xs text-plum-500">{check.detail}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

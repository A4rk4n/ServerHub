"use client";
import { RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { timeAgo } from "@/lib/format";
import { Btn } from "./ui";

type Report = {
  summary: { total: number; verified: number; corrupt: number; unverified: number };
  corrupt: Array<{ backupId: number; serverId: number; serverName: string; backupName: string; problem: string; verifiedAt: string }>;
};

/** Fleet-wide backup integrity: cached verdicts plus an operator-forced sweep. */
export function BackupVerificationPanel() {
  const [report, setReport] = useState<Report | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/backup-verification", { cache: "no-store" });
      if (r.ok) setReport(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function verifyNow() {
    setVerifying(true);
    setNote("");
    try {
      const r = await fetch("/api/backup-verification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "verify-now" }),
      });
      const j = await r.json();
      if (r.ok) {
        setReport(j);
        setNote(`Checked ${j.checked} archive${j.checked === 1 ? "" : "s"} — ${j.corrupt === 0 ? "no corruption found" : `${j.corrupt} corrupt`}.`);
      } else {
        setNote(j.error ?? "Verification failed to run.");
      }
    } catch {
      setNote("Verification failed to run.");
    } finally {
      setVerifying(false);
    }
  }

  const s = report?.summary;
  return (
    <section className="panel p-5">
      <div className="flex items-center">
        <div>
          <h2 className="font-display flex items-center gap-2 text-lg font-bold">
            <ShieldCheck size={18} className="text-emerald-500" />
            Backup integrity
          </h2>
          <p className="mt-1 text-xs text-plum-500">
            Every completed archive is re-hashed and tar-walked on a rolling schedule; a backup that fails verification raises a notification immediately.
          </p>
        </div>
        <div className="ml-auto">
          <Btn variant="subtle" loading={verifying} onClick={verifyNow}>
            <RefreshCw size={14} />
            Verify now
          </Btn>
        </div>
      </div>
      {s && (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: "Backups", value: String(s.total) },
            { label: "Verified", value: String(s.verified) },
            { label: "Corrupt", value: String(s.corrupt) },
            { label: "Awaiting sweep", value: String(s.unverified) },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-candy-100 p-3">
              <p className={`font-display text-base font-bold leading-none ${item.label === "Corrupt" && s.corrupt > 0 ? "text-red-500" : "text-plum-900"}`}>{item.value}</p>
              <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-plum-500">{item.label}</p>
            </div>
          ))}
        </div>
      )}
      {report && report.corrupt.length > 0 && (
        <div className="mt-4 space-y-2">
          {report.corrupt.map((item) => (
            <div key={item.backupId} className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50/50 p-3">
              <ShieldAlert size={15} className="mt-0.5 shrink-0 text-red-500" />
              <div>
                <p className="text-sm font-semibold text-plum-900">{item.serverName} · {item.backupName}</p>
                <p className="mt-0.5 text-xs text-plum-600">{item.problem}</p>
                <p className="mt-0.5 text-[11px] text-plum-400">verified {timeAgo(item.verifiedAt)} — delete this backup and create a fresh one; do not rely on it for restores.</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {note && <p className="mt-3 text-xs text-plum-600">{note}</p>}
    </section>
  );
}

"use client";

import { HardDrive, Lightbulb, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatBytes, type UsageCategory } from "@/lib/disk-usage";
import { Btn, Spin } from "./ui";

type Usage = {
  report: {
    totalBytes: number;
    categories: Record<UsageCategory, number>;
    fileCount: number;
    biggest: Array<{ path: string; sizeBytes: number; category: UsageCategory }>;
    truncated: boolean;
  };
  backups: { count: number; bytes: number };
  growth: { dayBytes: number | null; weekBytes: number | null };
  hints: string[];
  scannedAt: string;
};

const SEGMENTS: Array<{ key: UsageCategory | "backups"; label: string; color: string }> = [
  { key: "world", label: "World", color: "#34d399" },
  { key: "mods", label: "Mods & plugins", color: "#a78bfa" },
  { key: "logs", label: "Logs", color: "#fbbf24" },
  { key: "rest", label: "Everything else", color: "#94a3b8" },
  { key: "backups", label: "Backups", color: "#38bdf8" },
];

function GrowthChip({ label, bytes }: { label: string; bytes: number | null }) {
  if (bytes === null) return <span className="rounded-lg border border-candy-200 px-2.5 py-1 text-[12px] text-plum-400">{label}: no history yet</span>;
  const up = bytes > 0;
  const flat = bytes === 0;
  return (
    <span className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${flat ? "border-candy-200 text-plum-500" : up ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
      {flat ? null : up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
      {label}: {bytes > 0 ? "+" : ""}{formatBytes(bytes)}
    </span>
  );
}

export function DiskUsagePanel({ serverId, accent }: { serverId: number; accent: string }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`/api/servers/${serverId}/disk-usage`, { cache: "no-store" });
      const j = await r.json();
      if (r.ok) setUsage(j);
      else setError(j.error ?? "Scan failed");
    } catch {
      setError("Scan failed");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !usage) return <Spin label="Measuring disk usage…" />;

  const grand = usage ? usage.report.totalBytes + usage.backups.bytes : 0;
  const sizeOf = (key: UsageCategory | "backups") => (key === "backups" ? usage!.backups.bytes : usage!.report.categories[key]);

  return (
    <div className="panel p-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="font-display flex items-center gap-2 text-[15px] font-bold text-plum-900">
          <HardDrive size={16} style={{ color: accent }} /> Disk usage
        </h3>
        <Btn onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Rescan
        </Btn>
      </div>
      <p className="mb-4 text-[12px] text-plum-500">
        Where this server&apos;s storage goes — world data, mods, logs, backups — plus the biggest files and how fast it all grows.
      </p>
      {error ? <p className="text-[12.5px] font-semibold text-rose-600">{error}</p> : null}
      {usage ? (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-bold text-plum-900">{formatBytes(grand)}</span>
            <span className="text-[12px] text-plum-400">
              {usage.report.fileCount} files + {usage.backups.count} backup{usage.backups.count === 1 ? "" : "s"}
              {usage.report.truncated ? " · scan capped — totals are lower bounds" : ""}
            </span>
            <GrowthChip label="24h" bytes={usage.growth.dayBytes} />
            <GrowthChip label="7d" bytes={usage.growth.weekBytes} />
          </div>
          {grand > 0 ? (
            <div className="mb-2 flex h-4 w-full overflow-hidden rounded-full border border-candy-200">
              {SEGMENTS.filter((segment) => sizeOf(segment.key) > 0).map((segment) => (
                <div
                  key={segment.key}
                  title={`${segment.label}: ${formatBytes(sizeOf(segment.key))}`}
                  style={{ width: `${Math.max(1, (sizeOf(segment.key) / grand) * 100)}%`, backgroundColor: segment.color }}
                />
              ))}
            </div>
          ) : null}
          <div className="mb-4 flex flex-wrap gap-2">
            {SEGMENTS.map((segment) => (
              <span key={segment.key} className="flex items-center gap-1.5 rounded-lg border border-candy-200 px-2.5 py-1 text-[12px] text-plum-700">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
                {segment.label}: <span className="font-semibold">{formatBytes(sizeOf(segment.key))}</span>
              </span>
            ))}
          </div>
          {usage.hints.length > 0 ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-amber-800">
                <Lightbulb size={14} /> Cleanup hints
              </div>
              <ul className="list-disc space-y-1 pl-5 text-[12px] text-amber-800">
                {usage.hints.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {usage.report.biggest.length > 0 ? (
            <div>
              <div className="mb-1.5 text-[12.5px] font-semibold text-plum-800">Biggest files</div>
              <div className="space-y-1">
                {usage.report.biggest.map((file) => (
                  <div key={file.path} className="flex items-center gap-2 rounded-lg border border-candy-100 px-2.5 py-1.5 text-[12px]">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: SEGMENTS.find((segment) => segment.key === file.category)?.color }}
                      title={file.category}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-plum-700">{file.path}</span>
                    <span className="shrink-0 font-semibold text-plum-900">{formatBytes(file.sizeBytes)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-plum-400">No files yet.</p>
          )}
        </>
      ) : null}
    </div>
  );
}

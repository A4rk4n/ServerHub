"use client";

import { AlertTriangle, Download, PackageOpen, Ship } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Btn, Spin } from "./ui";

type Bundle = { file: string; sizeMb: number; createdAt: string };

export function ExportPanel({ serverId, accent }: { serverId: number; accent: string }) {
  const [bundles, setBundles] = useState<Bundle[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ file: string; fileCount: number; checksum: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/servers/${serverId}/export`, { cache: "no-store" });
      const j = await r.json();
      setBundles(j.exports ?? []);
    } catch {
      setBundles([]);
    }
  }, [serverId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function createBundle() {
    setCreating(true);
    setError(null);
    try {
      const r = await fetch(`/api/servers/${serverId}/export`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.error ?? `Export failed (HTTP ${r.status})`);
        return;
      }
      setLastResult({ file: j.file, fileCount: j.fileCount, checksum: j.checksum });
      await refresh();
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="panel p-5">
      <div className="mb-1 flex items-center gap-2">
        <Ship size={15} style={{ color: accent }} />
        <h3 className="font-display text-[13.5px] font-semibold text-plum-900">Export bundle</h3>
      </div>
      <p className="mb-3 text-[12px] text-plum-500">
        Pack this server into a portable archive: all files plus a manifest with game, version, launch settings, and a verification
        checksum — passwords are never included. Extract it anywhere and use <span className="font-semibold">Import</span> on another
        Server Hub to adopt it.
      </p>
      {error && (
        <div className="mb-3 flex items-center gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-[12px] text-rose-600">
          <AlertTriangle size={12} /> {error}
        </div>
      )}
      {lastResult && !error && (
        <div className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
          Created <span className="font-mono">{lastResult.file}</span> — {lastResult.fileCount} files, checksum{" "}
          <span className="font-mono">{lastResult.checksum.slice(0, 12)}…</span>
        </div>
      )}
      <div className="mb-3">
        <Btn variant="primary" accent={accent} onClick={createBundle} loading={creating}>
          <PackageOpen size={14} /> Create export bundle
        </Btn>
      </div>
      {bundles === null ? (
        <Spin label="Listing bundles…" />
      ) : bundles.length === 0 ? (
        <p className="rounded-lg bg-candy-50 px-3 py-2.5 text-[11.5px] text-plum-400">No export bundles yet.</p>
      ) : (
        <ul className="space-y-1">
          {bundles.map((bundle) => (
            <li key={bundle.file} className="flex items-center gap-2 rounded-lg bg-candy-50 px-3 py-2">
              <span className="min-w-0 truncate font-mono text-[12px] text-plum-800">{bundle.file}</span>
              <span className="shrink-0 text-[10.5px] text-plum-400">{bundle.sizeMb} MB</span>
              <a
                className="ml-auto flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold transition hover:bg-candy-100"
                style={{ color: accent }}
                href={`/api/servers/${serverId}/export?file=${encodeURIComponent(bundle.file)}`}
                download
              >
                <Download size={12} /> Download
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

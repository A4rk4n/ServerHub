"use client";

import { DatabaseBackup, Download, FolderSearch, History, Plus, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Backup as BackupRow } from "@/db/schema";

type Backup = BackupRow & { verification?: { ok: boolean; problem: string; verifiedAt: string } | null };
import { cn, hexA, timeAgo } from "@/lib/format";
import { Btn, Empty, Modal, Spin, inputCls } from "./ui";

function fmtSize(mb: number) {
  return mb >= 1000 ? `${(mb / 1000).toFixed(2)} GB` : `${mb} MB`;
}

export function BackupsManager({ serverId, accent, status }: { serverId: number; accent: string; status: string }) {
  const [backups, setBackups] = useState<Backup[] | null>(null);
  const [retention, setRetention] = useState<{ count: number; days: number; protectedId: number | null } | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<Backup | null>(null);
  const [restorePreview, setRestorePreview] = useState<{checksumValid:boolean;archiveBytes:number;entries:number;sample:string[]} | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Backup | null>(null);
  const [browseTarget, setBrowseTarget] = useState<Backup | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch(`/api/servers/${serverId}/backups`, { cache: "no-store" });
      const j = await r.json();
      if (j.backups) setBackups(j.backups);
      if (j.retention) setRetention(j.retention);
    } catch {}
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3600);
    return () => clearTimeout(t);
  }, [notice]);

  async function create() {
    setCreating(true);
    try {
      await fetch(`/api/servers/${serverId}/backups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setName("");
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function previewRestore(b: Backup) {
    setBusy(true); setNotice(null); try { const r=await fetch(`/api/servers/${serverId}/backups/${b.id}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"preview"})}); const j=await r.json(); if(!r.ok){setNotice(j.error??"Could not preview backup");return} setRestorePreview(j);setRestoreTarget(b); } finally {setBusy(false)}
  }

  async function restore(b: Backup) {
    setBusy(true);
    try {
      const r = await fetch(`/api/servers/${serverId}/backups/${b.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      });
      const j = await r.json();
      if (!r.ok) setNotice(j.error ?? "Restore failed");
      else setNotice(`Restored snapshot "${b.name}"`);
    } finally {
      setBusy(false);
      setRestoreTarget(null);
    }
  }

  async function remove(b: Backup) {
    setBusy(true);
    try {
      await fetch(`/api/servers/${serverId}/backups/${b.id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  }

  async function verify(b: Backup) {
    setBusy(true); try { const r=await fetch(`/api/servers/${serverId}/backups/${b.id}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"verify"})}); const j=await r.json(); setNotice(r.ok?`Verified ${j.entries} archive entries · SHA-256 matches`:j.error??"Backup verification failed"); } finally {setBusy(false)}
  }

  function downloadArchive(b: Backup) {
    const a = document.createElement("a");
    a.href = `/api/servers/${serverId}/backups/${b.id}`;
    a.download = `${b.name}.tar.gz`;
    a.click();
  }

  async function prune() {
    setPruning(true);
    try {
      const r = await fetch(`/api/servers/${serverId}/backups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prune" }),
      });
      const j = await r.json();
      if (!r.ok) setNotice(j.error ?? "Prune failed");
      else setNotice(j.pruned > 0 ? `Retention pruned ${j.pruned} backup${j.pruned === 1 ? "" : "s"} · ${j.kept} kept` : "Nothing to prune — all backups are within the retention limits");
      await load();
    } finally {
      setPruning(false);
    }
  }

  if (!backups) return <Spin label="Loading backups…" />;
  const totalMb = backups.filter((b) => b.status === "complete").reduce((a, b) => a + b.sizeMb, 0);
  const retentionActive = !!retention && (retention.count > 0 || retention.days > 0);
  const retentionLabel = !retentionActive
    ? "retention off"
    : [retention!.count > 0 ? `keep ${retention!.count}` : "", retention!.days > 0 ? `max ${retention!.days}d` : ""].filter(Boolean).join(" · ");

  return (
    <div className="space-y-5">
      <div className="panel flex flex-wrap items-center gap-3 p-4 sm:p-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: hexA(accent, 0.1), color: accent }}>
          <DatabaseBackup size={18} />
        </span>
        <div className="mr-auto">
          <p className="font-display text-[15px] font-semibold text-plum-900">Snapshots</p>
          <p className="text-[12px] text-plum-500">
            {backups.filter((b) => b.status === "complete").length} stored · {fmtSize(totalMb)} total · {retentionLabel}
          </p>
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="snapshot name (optional)"
          className={cn(inputCls, "w-52")}
          maxLength={48}
        />
        {retentionActive && (
          <Btn variant="subtle" onClick={prune} loading={pruning} title="Apply the retention limits from Settings now">
            <Trash2 size={15} /> Prune now
          </Btn>
        )}
        <Btn variant="primary" accent={accent} onClick={create} loading={creating}>
          <Plus size={15} /> Snapshot now
        </Btn>
      </div>

      {notice && (
        <div className="rounded-xl border border-candy-200 bg-candy-100 px-4 py-3 text-[12.5px] text-plum-700">{notice}</div>
      )}

      {backups.length === 0 ? (
        <Empty icon={<DatabaseBackup size={22} />} title="No backups yet" hint="Snapshot the world now, or let a scheduled task do it for you." />
      ) : (
        <div className="panel overflow-hidden">
          {backups.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center gap-3 border-b border-candy-200/60 px-4 py-3.5 transition last:border-0 hover:bg-candy-50 sm:flex-nowrap">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: hexA(accent, 0.09), color: accent }}>
                {b.status === "building" ? <RotateCcw size={15} className="animate-spin" /> : <History size={15} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate font-mono text-[13px] font-medium text-plum-900">
                  {b.name}.tar.gz
                  {retention?.protectedId === b.id && (
                    <span title="Update safety backup — never pruned by retention" className="inline-flex items-center" style={{ color: accent }}>
                      <ShieldCheck size={13} />
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[11px] text-plum-400">
                  {b.note || "manual"} · {timeAgo(b.createdAt)}
                  {b.status === "complete" && (
                    b.verification
                      ? b.verification.ok
                        ? <span className="ml-1.5 font-semibold text-emerald-600" title={`Archive verified ${timeAgo(b.verification.verifiedAt)}`}>· verified ✓</span>
                        : <span className="ml-1.5 font-semibold text-red-500" title={b.verification.problem}>· CORRUPT ✕</span>
                      : <span className="ml-1.5 text-plum-300" title="Awaiting the next integrity sweep">· not verified yet</span>
                  )}
                </p>
              </div>
              {b.status === "building" ? (
                <div className="h-2 w-40 overflow-hidden rounded-full bg-candy-100">
                  <div className="shimmer h-full w-full" />
                </div>
              ) : (
                <span className="font-mono text-[12px] text-plum-500">{fmtSize(b.sizeMb)}</span>
              )}
              <div className="flex items-center gap-1">
                <IconBtn title="Verify checksum and archive" onClick={() => void verify(b)} disabled={busy || b.status !== "complete"}>
                  <ShieldCheck size={14} />
                </IconBtn>
                <IconBtn title="Download backup archive" onClick={() => downloadArchive(b)} disabled={b.status !== "complete"}>
                  <Download size={14} />
                </IconBtn>
                <IconBtn title="Browse files inside this backup" onClick={() => setBrowseTarget(b)} disabled={b.status !== "complete"}>
                  <FolderSearch size={14} />
                </IconBtn>
                <span title={status !== "offline" ? "Stop the server to restore" : "Restore this snapshot"}>
                  <IconBtn
                    disabled={status !== "offline" || b.status !== "complete"}
                    onClick={() => void previewRestore(b)}
                    title="Restore"
                  >
                    <RotateCcw size={14} />
                  </IconBtn>
                </span>
                <IconBtn danger title="Delete" onClick={() => setDeleteTarget(b)}>
                  <Trash2 size={14} />
                </IconBtn>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!restoreTarget} onClose={() => {setRestoreTarget(null);setRestorePreview(null)}} title={`Restore "${restoreTarget?.name}"?`}>
        <p className="text-[13.5px] leading-relaxed text-plum-500">
          The current world state will be <span className="text-red-500">overwritten</span> with this snapshot ({restoreTarget && fmtSize(restoreTarget.sizeMb)}).
          This cannot be undone.
        </p>
        {restorePreview && <div className="mt-4 rounded-xl border border-candy-200 bg-candy-50 p-3 text-[12px] text-plum-600"><div className="grid grid-cols-2 gap-2"><span>Checksum</span><strong className={restorePreview.checksumValid?"text-emerald-600":"text-red-500"}>{restorePreview.checksumValid?"Verified":"Mismatch"}</strong><span>Archive entries</span><strong>{restorePreview.entries}</strong><span>Compressed size</span><strong>{fmtSize(Math.ceil(restorePreview.archiveBytes/1048576))}</strong></div>{restorePreview.sample.length>0&&<details className="mt-3"><summary className="cursor-pointer font-semibold">Preview included paths</summary><ul className="mt-2 max-h-32 overflow-auto font-mono text-[10px]">{restorePreview.sample.map(path=><li key={path} className="truncate">{path}</li>)}</ul></details>}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => {setRestoreTarget(null);setRestorePreview(null)}}>Cancel</Btn>
          <Btn variant="primary" accent={accent} loading={busy} disabled={!restorePreview?.checksumValid} onClick={() => restoreTarget && restore(restoreTarget)}>
            <RotateCcw size={14} /> Restore snapshot
          </Btn>
        </div>
      </Modal>

      {browseTarget && <BackupBrowser serverId={serverId} backup={browseTarget} accent={accent} serverStatus={status} onClose={() => setBrowseTarget(null)} />}

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={`Delete "${deleteTarget?.name}"?`}>
        <p className="text-[13.5px] text-plum-500">The archive will be permanently removed from this PC.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Btn>
          <Btn variant="danger" loading={busy} onClick={() => deleteTarget && remove(deleteTarget)}>
            <Trash2 size={14} /> Delete backup
          </Btn>
        </div>
      </Modal>
    </div>
  );
}

function IconBtn({ children, onClick, title, danger, disabled }: { children: React.ReactNode; onClick?: () => void; title: string; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-lg border border-candy-200 bg-candy-50 p-2 text-plum-500 transition hover:bg-candy-100 hover:text-plum-900 disabled:cursor-not-allowed disabled:opacity-30",
        danger && "hover:border-red-300 hover:text-red-500"
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Backup browser: look inside an archive, preview or download single
// files, and restore one file at a time (server must be stopped).
// ---------------------------------------------------------------------------

type ArchiveEntry = { path: string; size: number; type: "file" | "dir"; mtime: number | null };

function entrySize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const PREVIEWABLE = [".properties", ".json", ".json5", ".yml", ".yaml", ".toml", ".txt", ".log", ".cfg", ".conf", ".ini", ".env", ".sh", ".bat", ".cmd", ".mcmeta", ".csv", ".md", ".xml"];

function BackupBrowser({ serverId, backup, accent, serverStatus, onClose }: { serverId: number; backup: Backup; accent: string; serverStatus: string; onClose: () => void }) {
  const [entries, setEntries] = useState<ArchiveEntry[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [preview, setPreview] = useState<{ path: string; text: string } | null>(null);
  const [busyPath, setBusyPath] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let dead = false;
    void (async () => {
      try {
        const r = await fetch(`/api/servers/${serverId}/backups/${backup.id}/entries`, { cache: "no-store" });
        const j = await r.json();
        if (dead) return;
        if (!r.ok) return setError(j.error ?? "Could not open the archive");
        setEntries(j.entries);
        setTruncated(Boolean(j.truncated));
      } catch {
        if (!dead) setError("Could not open the archive");
      }
    })();
    return () => { dead = true; };
  }, [serverId, backup.id]);

  async function previewFile(entry: ArchiveEntry) {
    setBusyPath(entry.path);
    setNotice("");
    try {
      const r = await fetch(`/api/servers/${serverId}/backups/${backup.id}/entries?path=${encodeURIComponent(entry.path)}&preview=1`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) return setNotice(j.error ?? "Preview failed");
      setPreview({ path: j.path, text: j.text });
    } finally {
      setBusyPath("");
    }
  }

  function downloadFile(entry: ArchiveEntry) {
    const a = document.createElement("a");
    a.href = `/api/servers/${serverId}/backups/${backup.id}/entries?path=${encodeURIComponent(entry.path)}`;
    a.download = entry.path.split("/").pop() ?? entry.path;
    a.click();
  }

  async function restoreFile(entry: ArchiveEntry) {
    if (!window.confirm(`Restore this single file from "${backup.name}"?\n\n${entry.path}\n\nThe current copy in the server directory will be overwritten.`)) return;
    setBusyPath(entry.path);
    setNotice("");
    try {
      const r = await fetch(`/api/servers/${serverId}/backups/${backup.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore-entry", path: entry.path }),
      });
      const j = await r.json();
      setNotice(r.ok ? `Restored ${entry.path}` : j.error ?? "Restore failed");
    } finally {
      setBusyPath("");
    }
  }

  const files = (entries ?? []).filter((entry) => entry.type === "file" && (!filter || entry.path.toLowerCase().includes(filter.toLowerCase())));
  const offline = serverStatus === "offline" || serverStatus === "crashed" || serverStatus === "error";
  const canPreview = (entry: ArchiveEntry) => PREVIEWABLE.some((ext) => entry.path.toLowerCase().endsWith(ext)) && entry.size <= 262144;

  return (
    <Modal open onClose={onClose} title={`Inside "${backup.name}"`} wide>
      {error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : entries === null ? (
        <Spin label="Reading archive…" />
      ) : preview ? (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <code className="truncate text-xs text-plum-600">{preview.path}</code>
            <Btn size="sm" variant="subtle" onClick={() => setPreview(null)}>Back to files</Btn>
          </div>
          <pre className="max-h-96 overflow-auto rounded-xl border border-candy-200 bg-plum-900 p-3 font-mono text-[11px] leading-relaxed text-white">{preview.text}</pre>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input className={inputCls} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Search ${files.length} files…`} />
          </div>
          {truncated && <p className="text-[11px] text-amber-600">This archive has more than 5000 entries — only the first 5000 are listed.</p>}
          {notice && <p className="text-xs" style={{ color: notice.startsWith("Restored") ? "#059669" : "#ef4444" }}>{notice}</p>}
          {!offline && <p className="text-[11px] text-plum-400">Preview and download work any time; restoring a file requires the server to be stopped.</p>}
          <div className="max-h-96 space-y-1 overflow-auto">
            {files.slice(0, 500).map((entry) => (
              <div key={entry.path} className="flex items-center justify-between gap-2 rounded-lg border border-candy-100 px-2.5 py-1.5 text-xs">
                <code className="min-w-0 flex-1 truncate text-plum-700" title={entry.path}>{entry.path}</code>
                <span className="shrink-0 font-mono text-[10px] text-plum-400">{entrySize(entry.size)}</span>
                <div className="flex shrink-0 items-center gap-1">
                  {canPreview(entry) && (
                    <button className="rounded-md border border-candy-200 px-2 py-1 text-[10px] font-semibold text-plum-600 hover:bg-candy-50" disabled={busyPath !== ""} onClick={() => void previewFile(entry)}>
                      {busyPath === entry.path ? "…" : "Preview"}
                    </button>
                  )}
                  <button className="rounded-md border border-candy-200 px-2 py-1 text-[10px] font-semibold text-plum-600 hover:bg-candy-50" onClick={() => downloadFile(entry)}>Download</button>
                  <button
                    className="rounded-md border border-candy-200 px-2 py-1 text-[10px] font-semibold text-plum-600 hover:bg-candy-50 disabled:cursor-not-allowed disabled:opacity-30"
                    disabled={!offline || busyPath !== ""}
                    title={offline ? "Restore just this file" : "Stop the server to restore files"}
                    onClick={() => void restoreFile(entry)}
                  >
                    Restore
                  </button>
                </div>
              </div>
            ))}
            {files.length === 0 && <p className="py-6 text-center text-xs text-plum-400">No files match.</p>}
            {files.length > 500 && <p className="py-2 text-center text-[10px] text-plum-400">Showing the first 500 matches — narrow the search to see more.</p>}
          </div>
          <div className="flex justify-end">
            <Btn variant="ghost" onClick={onClose}>Close</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

"use client";

import { DatabaseBackup, Download, History, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Backup } from "@/db/schema";
import { cn, hexA, timeAgo } from "@/lib/format";
import { Btn, Empty, Modal, Spin, inputCls } from "./ui";

function fmtSize(mb: number) {
  return mb >= 1000 ? `${(mb / 1000).toFixed(2)} GB` : `${mb} MB`;
}

export function BackupsManager({ serverId, accent, status }: { serverId: number; accent: string; status: string }) {
  const [backups, setBackups] = useState<Backup[] | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<Backup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Backup | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch(`/api/servers/${serverId}/backups`, { cache: "no-store" });
      const j = await r.json();
      if (j.backups) setBackups(j.backups);
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

  function downloadArchive(b: Backup) {
    const a = document.createElement("a");
    a.href = `/api/servers/${serverId}/backups/${b.id}`;
    a.download = `${b.name}.tar.gz`;
    a.click();
  }

  if (!backups) return <Spin label="Loading backups…" />;
  const totalMb = backups.filter((b) => b.status === "complete").reduce((a, b) => a + b.sizeMb, 0);

  return (
    <div className="space-y-5">
      <div className="panel flex flex-wrap items-center gap-3 p-4 sm:p-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: hexA(accent, 0.1), color: accent }}>
          <DatabaseBackup size={18} />
        </span>
        <div className="mr-auto">
          <p className="font-display text-[15px] font-semibold text-plum-900">Snapshots</p>
          <p className="text-[12px] text-plum-500">
            {backups.filter((b) => b.status === "complete").length} stored · {fmtSize(totalMb)} total · local archives
          </p>
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="snapshot name (optional)"
          className={cn(inputCls, "w-52")}
          maxLength={48}
        />
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
                <p className="truncate font-mono text-[13px] font-medium text-plum-900">{b.name}.tar.gz</p>
                <p className="mt-0.5 text-[11px] text-plum-400">
                  {b.note || "manual"} · {timeAgo(b.createdAt)}
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
                <IconBtn title="Download backup archive" onClick={() => downloadArchive(b)} disabled={b.status !== "complete"}>
                  <Download size={14} />
                </IconBtn>
                <span title={status !== "offline" ? "Stop the server to restore" : "Restore this snapshot"}>
                  <IconBtn
                    disabled={status !== "offline" || b.status !== "complete"}
                    onClick={() => setRestoreTarget(b)}
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

      <Modal open={!!restoreTarget} onClose={() => setRestoreTarget(null)} title={`Restore "${restoreTarget?.name}"?`}>
        <p className="text-[13.5px] leading-relaxed text-plum-500">
          The current world state will be <span className="text-red-500">overwritten</span> with this snapshot ({restoreTarget && fmtSize(restoreTarget.sizeMb)}).
          This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setRestoreTarget(null)}>Cancel</Btn>
          <Btn variant="primary" accent={accent} loading={busy} onClick={() => restoreTarget && restore(restoreTarget)}>
            <RotateCcw size={14} /> Restore snapshot
          </Btn>
        </div>
      </Modal>

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

"use client";

import { motion } from "framer-motion";
import { Boxes, FolderInput, Play, Plus, RotateCw, Search, Square } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { type BulkAction, partitionBulkAction } from "@/lib/bulk-power";
import type { CardServer } from "./server-card";
import { ServerCard } from "./server-card";
import { Btn, Empty, Modal, inputCls } from "./ui";

const FILTERS = ["all", "online", "offline"] as const;

const BULK_META: Record<BulkAction, { label: string; icon: React.ComponentType<{ size?: number | string }>; danger: boolean }> = {
  start: { label: "Start", icon: Play, danger: false },
  restart: { label: "Restart", icon: RotateCw, danger: false },
  stop: { label: "Stop", icon: Square, danger: true },
};

export function ServersView({ initial }: { initial: CardServer[] }) {
  const [servers, setServers] = useState(initial);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [arming, setArming] = useState<BulkAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importDir, setImportDir] = useState("");
  const [inspection, setInspection] = useState<{ directory: string; detected: string | null; detectedName: string | null; fileCount: number } | null>(null);
  const [importName, setImportName] = useState("");
  const [importPort, setImportPort] = useState("");
  const [importLaunch, setImportLaunch] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [importEula, setImportEula] = useState(false);
  const [importError, setImportError] = useState("");
  const [importBusy, setImportBusy] = useState(false);

  useEffect(() => {
    let dead = false;
    const poll = async () => {
      try {
        const r = await fetch("/api/servers", { cache: "no-store" });
        const j = await r.json();
        if (!dead && j.servers) setServers(j.servers);
      } catch {}
    };
    const t = setInterval(poll, 7000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const filtered = useMemo(() => {
    return servers.filter((s) => {
      if (filter === "online" && s.status !== "online") return false;
      if (filter === "offline" && !["offline", "crashed", "error"].includes(s.status)) return false;
      if (q && !(s.name + s.game.name + s.gameId).toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [servers, q, filter]);

  async function runBulk(action: BulkAction) {
    const { eligible } = partitionBulkAction(filtered, action);
    if (eligible.length === 0) return;
    // Two-click confirmation: the first click arms the button for 4s.
    if (arming !== action) {
      setArming(action);
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArming(null), 4000);
      return;
    }
    setArming(null);
    setBusy(true);
    try {
      const r = await fetch("/api/servers/bulk-power", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: eligible.map((s) => s.id) }),
      });
      const j = await r.json();
      if (!r.ok) setNotice(j.error ?? "Bulk action failed");
      else {
        const results = j.results as Array<{ outcome: string }>;
        const done = results.filter((x) => x.outcome === "ok").length;
        const scheduled = results.filter((x) => x.outcome === "scheduled").length;
        const failed = results.filter((x) => x.outcome === "failed").length;
        const skipped = results.filter((x) => x.outcome === "skipped").length;
        setNotice(
          [
            scheduled ? `${scheduled} start${scheduled === 1 ? "" : "s"} scheduled (2.5s apart)` : "",
            done ? `${done} ${action === "stop" ? "stopping" : "restarting"}` : "",
            failed ? `${failed} failed` : "",
            skipped ? `${skipped} skipped` : "",
          ]
            .filter(Boolean)
            .join(" · ")
        );
      }
    } catch {
      setNotice("Bulk action failed");
    } finally {
      setBusy(false);
    }
  }

  function resetImport() {
    setImportOpen(false);
    setImportDir("");
    setInspection(null);
    setImportName("");
    setImportPort("");
    setImportLaunch("");
    setImportPassword("");
    setImportEula(false);
    setImportError("");
  }

  async function inspectDirectory() {
    setImportBusy(true);
    setImportError("");
    setInspection(null);
    try {
      const r = await fetch("/api/servers/import/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directory: importDir }),
      });
      const j = await r.json();
      if (!r.ok) setImportError(j.error ?? "Could not inspect that folder");
      else setInspection(j);
    } catch {
      setImportError("Could not inspect that folder");
    } finally {
      setImportBusy(false);
    }
  }

  async function adoptDirectory() {
    if (!inspection) return;
    setImportBusy(true);
    setImportError("");
    try {
      const r = await fetch("/api/servers/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: inspection.directory,
          name: importName,
          ...(importPort.trim() ? { port: Number(importPort) } : {}),
          ...(inspection.detected ? {} : { gameId: "custom", launchCommand: importLaunch }),
          ...(importPassword ? { serverPassword: importPassword } : {}),
          eulaAccepted: importEula,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setImportError(j.error ?? "Import failed");
        return;
      }
      resetImport();
      setNotice(`${j.server.name} adopted — it is ready to start`);
      try {
        const list = await fetch("/api/servers", { cache: "no-store" });
        const data = await list.json();
        if (data.servers) setServers(data.servers);
      } catch {}
    } catch {
      setImportError("Import failed");
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }} className="font-display text-3xl font-bold tracking-tight text-plum-900">
            Servers
          </motion.h1>
          <p className="mt-1 text-[13.5px] text-plum-500">
            {servers.filter((s) => s.status === "online").length} of {servers.length} server processes running on this PC
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-plum-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search servers…" className={`${inputCls} w-52 pl-9`} />
          </div>
          <Btn variant="subtle" onClick={() => setImportOpen(true)}>
            <FolderInput size={15} /> Import existing
          </Btn>
          <Link href="/servers/new">
            <Btn variant="primary">
              <Plus size={15} /> New server
            </Btn>
          </Link>
        </div>
      </div>

      <Modal open={importOpen} onClose={resetImport} title="Import an existing server" wide>
        <div className="space-y-4">
          <p className="text-[12.5px] text-plum-500">
            Point Server Hub at a server folder you already have on disk. The folder is adopted as-is — nothing is downloaded, moved, or reinstalled, and deleting the server later leaves the folder untouched.
          </p>
          <div className="flex gap-2">
            <input
              value={importDir}
              onChange={(e) => setImportDir(e.target.value)}
              placeholder={"Absolute folder path, e.g. D:\\Servers\\MyValheim"}
              className={`${inputCls} flex-1 font-mono text-[12.5px]`}
            />
            <Btn variant="primary" onClick={() => void inspectDirectory()} loading={importBusy} disabled={!importDir.trim()}>
              Inspect
            </Btn>
          </div>
          {inspection && (
            <div className="space-y-3 rounded-2xl border border-candy-200 bg-candy-50 p-4">
              <p className="text-[12.5px] font-semibold text-plum-700">
                {inspection.detected
                  ? `Detected: ${inspection.detectedName} (${inspection.fileCount} files scanned)`
                  : `No known game detected (${inspection.fileCount} files scanned) — it can be adopted as a custom server with a launch command.`}
              </p>
              <input value={importName} onChange={(e) => setImportName(e.target.value)} placeholder="Server name" className={inputCls} maxLength={60} />
              <input value={importPort} onChange={(e) => setImportPort(e.target.value)} placeholder="Port (blank = game default)" className={inputCls} inputMode="numeric" />
              {!inspection.detected && (
                <input value={importLaunch} onChange={(e) => setImportLaunch(e.target.value)} placeholder="Launch command (required for custom servers)" className={`${inputCls} font-mono text-[12.5px]`} />
              )}
              {inspection.detected === "valheim" && (
                <input value={importPassword} onChange={(e) => setImportPassword(e.target.value)} placeholder="Server password (Valheim requires one, min 5 chars)" className={inputCls} type="password" />
              )}
              {(inspection.detected === "minecraft" || inspection.detected === "minecraft-modded") && (
                <label className="flex items-center gap-2 text-[12.5px] text-plum-600">
                  <input type="checkbox" checked={importEula} onChange={(e) => setImportEula(e.target.checked)} />
                  I accept the Minecraft EULA for this server
                </label>
              )}
              <Btn variant="primary" onClick={() => void adoptDirectory()} loading={importBusy} disabled={!importName.trim()}>
                <FolderInput size={15} /> Adopt server
              </Btn>
            </div>
          )}
          {importError && <p className="text-[12.5px] font-semibold text-rose-600">{importError}</p>}
        </div>
      </Modal>

      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold capitalize transition ${
              filter === f ? "bg-candy-100 text-plum-900" : "text-plum-500 hover:bg-candy-50 hover:text-plum-700"
            }`}
          >
            {f}
          </button>
        ))}
        {servers.length > 1 && (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-plum-400">
              fleet{filter !== "all" || q ? " (filtered)" : ""}
            </span>
            {(Object.keys(BULK_META) as BulkAction[]).map((action) => {
              const meta = BULK_META[action];
              const count = partitionBulkAction(filtered, action).eligible.length;
              const armed = arming === action;
              return (
                <Btn
                  key={action}
                  size="sm"
                  variant={armed ? (meta.danger ? "danger" : "primary") : "subtle"}
                  disabled={count === 0 || busy}
                  onClick={() => void runBulk(action)}
                  title={`${meta.label} the ${count} eligible server${count === 1 ? "" : "s"} shown`}
                >
                  <meta.icon size={13} /> {armed ? `Confirm ${meta.label.toLowerCase()} ${count}?` : `${meta.label} ${count > 0 ? count : ""}`}
                </Btn>
              );
            })}
            {notice && <span className="ml-1 text-[11.5px] font-semibold text-plum-500">{notice}</span>}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <Empty
          icon={<Boxes size={22} />}
          title={q ? "Nothing matches your search" : "No servers here yet"}
          hint={q ? "Try a different name or clear the filter." : "Deploy your first instance and watch it boot in real time."}
          action={
            <Link href="/servers/new">
              <Btn variant="primary">
                <Plus size={15} /> Create server
              </Btn>
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((s, i) => (
            <ServerCard key={s.id} server={s} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

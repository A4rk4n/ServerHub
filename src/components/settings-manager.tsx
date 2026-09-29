"use client";

import { AlertTriangle, Check, CloudDownload, Cpu, Globe, KeyRound, RefreshCw, RotateCw, Save, Swords, Terminal, Trash2, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Server } from "@/db/schema";
import { cn, hexA } from "@/lib/format";
import { Btn, Field, Modal, Toggle, inputCls } from "./ui";

type GameInfo = {
  accent: string;
  minMemory: number;
  maxMemory: number;
  maxPlayersCap: number;
  difficulty: boolean;
  short: string;
  protocol: string;
  installer: string;
  requiresPassword: boolean;
};

export function SettingsManager({ initial, game }: { initial: Server; game: GameInfo }) {
  const router = useRouter();
  const accent = game.accent;
  const [form, setForm] = useState({
    name: initial.name,
    motd: initial.motd,
    port: initial.port,
    bindAddress: initial.bindAddress,
    publicAddress: initial.publicAddress,
    readinessTimeoutSec: initial.readinessTimeoutSec,
    memoryMb: initial.memoryMb,
    maxPlayers: initial.maxPlayers,
    worldName: initial.worldName,
    seed: initial.seed,
    difficulty: initial.difficulty,
    pvp: initial.pvp,
    autoRestart: initial.autoRestart,
    maxCrashRestarts: initial.maxCrashRestarts,
    restartWindowSec: initial.restartWindowSec,
    autoBackupBeforeUpdate: initial.autoBackupBeforeUpdate,
    updateBackupRetention: initial.updateBackupRetention,
    serverPassword: initial.serverPassword,
    launchCommand: initial.launchCommand,
    launchArgs: initial.launchArgs,
    workingDirectory: initial.workingDirectory,
  });
  const [saving, setSaving] = useState(false);
  const [resettingCredentials, setResettingCredentials] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [delName, setDelName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{supported:boolean; currentVersion:string; latestVersion?:string; updateAvailable?:boolean; rolling?:boolean; provider?:string; reason?:string} | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);

  const dirty =
    form.name !== initial.name ||
    form.motd !== initial.motd ||
    form.port !== initial.port ||
    form.bindAddress !== initial.bindAddress ||
    form.publicAddress !== initial.publicAddress ||
    form.readinessTimeoutSec !== initial.readinessTimeoutSec ||
    form.memoryMb !== initial.memoryMb ||
    form.maxPlayers !== initial.maxPlayers ||
    form.worldName !== initial.worldName ||
    form.seed !== initial.seed ||
    form.difficulty !== initial.difficulty ||
    form.pvp !== initial.pvp ||
    form.autoRestart !== initial.autoRestart ||
    form.maxCrashRestarts !== initial.maxCrashRestarts ||
    form.restartWindowSec !== initial.restartWindowSec ||
    form.autoBackupBeforeUpdate !== initial.autoBackupBeforeUpdate ||
    form.updateBackupRetention !== initial.updateBackupRetention ||
    form.serverPassword !== initial.serverPassword ||
    form.launchCommand !== initial.launchCommand ||
    form.launchArgs !== initial.launchArgs ||
    form.workingDirectory !== initial.workingDirectory;

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(`/api/servers/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok) setErr(j.error ?? "Save failed");
      else {
        setSavedAt(Date.now());
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  async function checkUpdate() {
    setCheckingUpdate(true); setErr(null);
    try { const response=await fetch(`/api/servers/${initial.id}/updates`,{cache:"no-store"}); const body=await response.json(); if(!response.ok) throw new Error(body.error??"Update check failed"); setUpdateInfo(body); }
    catch(error) { setErr(error instanceof Error?error.message:String(error)); }
    finally { setCheckingUpdate(false); }
  }

  async function applyUpdate() {
    setUpdating(true); setErr(null);
    try { const response=await fetch(`/api/servers/${initial.id}/updates`,{method:"POST"}); const body=await response.json(); if(!response.ok) throw new Error(body.error??body.reason??"Update failed"); router.refresh(); }
    catch(error) { setErr(error instanceof Error?error.message:String(error)); }
    finally { setUpdating(false); }
  }

  async function resetCredentials() {
    if (!window.confirm("Reset all stored passwords and the Player/Owner ID for this server? This cannot decrypt or recover credentials protected by another Windows account.")) return;
    setResettingCredentials(true); setErr(null);
    try {
      const response=await fetch(`/api/servers/${initial.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({resetCredentials:true})});
      const body=await response.json(); if(!response.ok) throw new Error(body.error??"Credential reset failed");
      setForm(current=>({...current,serverPassword:""})); setSavedAt(Date.now()); router.refresh();
    } catch(error) { setErr(error instanceof Error?error.message:String(error)); }
    finally { setResettingCredentials(false); }
  }

  async function destroy() {
    setDeleting(true);
    try {
      await fetch(`/api/servers/${initial.id}`, { method: "DELETE" });
      router.push("/");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        {/* identity */}
        <section className="panel p-5">
          <h3 className="font-display mb-4 flex items-center gap-2 text-[14px] font-semibold text-plum-900">
            <User size={14} style={{ color: accent }} /> Identity
          </h3>
          <div className="space-y-4">
            <Field label="Server name">
              <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} />
            </Field>
            <Field label="MOTD / description" hint={`${form.motd.length}/140`}>
              <input className={inputCls} value={form.motd} onChange={(e) => setForm({ ...form, motd: e.target.value })} maxLength={140} />
            </Field>
          </div>
        </section>

        {/* network */}
        <section className="panel p-5">
          <h3 className="font-display mb-4 flex items-center gap-2 text-[14px] font-semibold text-plum-900">
            <Globe size={14} style={{ color: accent }} /> Network
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Game port" hint={game.protocol}>
              <input className={cn(inputCls, "font-mono")} type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} min={1024} max={65535} />
            </Field>
            <Field label="Query port" hint="auto">
              <input className={cn(inputCls, "font-mono opacity-60")} readOnly value={game.protocol === "UDP" ? form.port + 1 : form.port} />
            </Field>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-4"><Field label="Bind IP" hint="local server interface"><input className={cn(inputCls,"font-mono")} value={form.bindAddress} onChange={(e)=>setForm({...form,bindAddress:e.target.value})}/></Field><Field label="Public address" hint="what internet players enter"><input className={cn(inputCls,"font-mono")} value={form.publicAddress} onChange={(e)=>setForm({...form,publicAddress:e.target.value})}/></Field><Field label="Readiness timeout" hint="seconds"><input className={cn(inputCls,"font-mono")} type="number" min={10} max={300} value={form.readinessTimeoutSec} onChange={(e)=>setForm({...form,readinessTimeoutSec:Number(e.target.value)})}/></Field></div>
          <p className="mt-3 rounded-lg bg-candy-50 px-3 py-2 font-mono text-[11px] text-plum-500">
            LAN players use <span className="text-plum-800">{form.bindAddress}:{form.port}</span>; internet players use <span className="text-plum-800">{form.publicAddress}:{form.port}</span>. Forward the game ports to {form.bindAddress}.
          </p>
        </section>

        {/* gameplay */}
        <section className="panel p-5">
          <h3 className="font-display mb-4 flex items-center gap-2 text-[14px] font-semibold text-plum-900">
            <Swords size={14} style={{ color: accent }} /> Gameplay
          </h3>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="World name">
                <input className={inputCls} value={form.worldName} onChange={(e) => setForm({ ...form, worldName: e.target.value })} maxLength={40} />
              </Field>
              <Field label="Seed" hint="optional">
                <input className={cn(inputCls, "font-mono")} value={form.seed} onChange={(e) => setForm({ ...form, seed: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Difficulty" hint={game.difficulty ? undefined : `n/a for ${game.short}`}>
                <select className={cn(inputCls, !game.difficulty && "opacity-50")} disabled={!game.difficulty} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
                  {["peaceful", "easy", "normal", "hard"].map((d) => (
                    <option key={d} value={d} className="bg-white capitalize">{d}</option>
                  ))}
                </select>
              </Field>
              <Field label={`Player slots — ${form.maxPlayers}`} hint={`max ${game.maxPlayersCap}`}>
                <input
                  type="range"
                  min={1}
                  max={game.maxPlayersCap}
                  value={form.maxPlayers}
                  onChange={(e) => setForm({ ...form, maxPlayers: Number(e.target.value) })}
                  className="mt-2.5 w-full"
                  style={{ ["--accent" as never]: accent, ["--fill" as never]: `${(form.maxPlayers / game.maxPlayersCap) * 100}%` }}
                />
              </Field>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-candy-200 bg-candy-50 px-4 py-3">
              <div>
                <p className="text-[13.5px] font-medium text-plum-800">PvP enabled</p>
                <p className="text-[11.5px] text-plum-500">Players can damage each other</p>
              </div>
              <Toggle checked={form.pvp} onChange={(v) => setForm({ ...form, pvp: v })} accent={accent} />
            </div>
          </div>
        </section>
      </div>

      <div className="space-y-5">
        {game.requiresPassword && (
          <section className="panel p-5">
            <h3 className="font-display mb-4 flex items-center gap-2 text-[14px] font-semibold text-plum-900">
              <KeyRound size={14} style={{ color: accent }} /> Access
            </h3>
            <Field label="Server password" hint="stored only in your local database">
              <input
                className={inputCls}
                type="password"
                value={form.serverPassword}
                onFocus={() => form.serverPassword === "••••••••" && setForm({ ...form, serverPassword: "" })}
                onChange={(e) => setForm({ ...form, serverPassword: e.target.value })}
                minLength={5}
                autoComplete="new-password"
              />
            </Field>
          </section>
        )}

        {game.installer === "manual" && (
          <section className="panel p-5">
            <h3 className="font-display mb-4 flex items-center gap-2 text-[14px] font-semibold text-plum-900">
              <Terminal size={14} style={{ color: accent }} /> Process
            </h3>
            <div className="space-y-4">
              <Field label="Launch executable or script" hint="absolute or relative to working folder">
                <input className={cn(inputCls, "font-mono")} value={form.launchCommand} onChange={(e) => setForm({ ...form, launchCommand: e.target.value })} />
              </Field>
              <Field label="Arguments" hint="quotes are supported">
                <input className={cn(inputCls, "font-mono")} value={form.launchArgs} onChange={(e) => setForm({ ...form, launchArgs: e.target.value })} />
              </Field>
              <Field label="Working directory" hint="existing absolute folder; blank uses managed storage">
                <input className={cn(inputCls, "font-mono")} value={form.workingDirectory} onChange={(e) => setForm({ ...form, workingDirectory: e.target.value })} />
              </Field>
            </div>
          </section>
        )}

        {game.installer !== "manual" && (
          <section className="panel p-5">
            <h3 className="font-display mb-3 flex items-center gap-2 text-[14px] font-semibold text-plum-900">
              <CloudDownload size={14} style={{ color: accent }} /> Updates
            </h3>
            <p className="text-[12px] leading-relaxed text-plum-500">
              Check the official provider and install updates through Server Hub’s staged, rollback-safe installation system.
            </p>
            {updateInfo && (
              <div className="mt-3 rounded-xl border border-candy-200 bg-candy-50 px-4 py-3 text-[12px]">
                <p className="font-medium text-plum-800">
                  {updateInfo.rolling ? "Latest provider build can be refreshed" : updateInfo.updateAvailable ? `${updateInfo.latestVersion} is available` : "Already up to date"}
                </p>
                <p className="mt-1 text-plum-500">Installed: {updateInfo.currentVersion}{updateInfo.provider ? ` · ${updateInfo.provider}` : ""}</p>
              </div>
            )}
            <div className="mt-4 flex items-center justify-between rounded-xl border border-candy-200 bg-candy-50 px-4 py-3">
              <div><p className="text-[13px] font-medium text-plum-800">Safety backup before updates</p><p className="text-[11px] text-plum-500">An update will not start unless the backup completes.</p></div>
              <Toggle checked={form.autoBackupBeforeUpdate} onChange={(value)=>setForm({...form,autoBackupBeforeUpdate:value})} accent={accent}/>
            </div>
            {form.autoBackupBeforeUpdate && <div className="mt-3"><Field label="Automatic update backups to keep" hint="1–20"><input className={cn(inputCls,"font-mono")} type="number" min={1} max={20} value={form.updateBackupRetention} onChange={(event)=>setForm({...form,updateBackupRetention:Number(event.target.value)})}/></Field></div>}
            <div className="mt-4 flex gap-2">
              <Btn variant="subtle" loading={checkingUpdate} onClick={checkUpdate}><RefreshCw size={14}/> Check</Btn>
              {updateInfo?.updateAvailable && (
                <Btn variant="primary" accent={accent} loading={updating} disabled={!['offline','crashed','error'].includes(initial.status)} onClick={applyUpdate}>
                  <CloudDownload size={14}/> {updateInfo.rolling ? "Refresh build" : "Install update"}
                </Btn>
              )}
            </div>
            {updateInfo?.updateAvailable && !['offline','crashed','error'].includes(initial.status) && <p className="mt-2 text-[11px] text-amber-700">Stop the server before updating.</p>}
          </section>
        )}

        {/* watchdog */}
        <section className="panel p-5">
          <h3 className="font-display mb-4 flex items-center gap-2 text-[14px] font-semibold text-plum-900">
            <RotateCw size={14} style={{ color: accent }} /> Crash recovery
          </h3>
          <div className="flex items-center justify-between rounded-xl border border-candy-200 bg-candy-50 px-4 py-3">
            <div>
              <p className="text-[13.5px] font-medium text-plum-800">Automatic restart</p>
              <p className="text-[11.5px] text-plum-500">Restart after an unexpected process exit</p>
            </div>
            <Toggle checked={form.autoRestart} onChange={(value) => setForm({ ...form, autoRestart: value })} accent={accent} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Field label="Restart limit" hint="0–20 attempts">
              <input
                className={cn(inputCls, "font-mono")}
                type="number"
                min={0}
                max={20}
                disabled={!form.autoRestart}
                value={form.maxCrashRestarts}
                onChange={(event) => setForm({ ...form, maxCrashRestarts: Number(event.target.value) })}
              />
            </Field>
            <Field label="Time window" hint="seconds">
              <input
                className={cn(inputCls, "font-mono")}
                type="number"
                min={30}
                max={3600}
                disabled={!form.autoRestart}
                value={form.restartWindowSec}
                onChange={(event) => setForm({ ...form, restartWindowSec: Number(event.target.value) })}
              />
            </Field>
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-plum-500">
            Restarts use exponential backoff and stop at the configured limit to prevent crash loops. A manual start resets the counter.
          </p>
        </section>

        {/* resources */}
        <section className="panel p-5">
          <h3 className="font-display mb-4 flex items-center gap-2 text-[14px] font-semibold text-plum-900">
            <Cpu size={14} style={{ color: accent }} /> Resources
          </h3>
          <Field label={`Memory — ${(form.memoryMb / 1024).toFixed(1)} GB`} hint={`${game.minMemory / 1024}G min · ${game.maxMemory / 1024}G max`}>
            <input
              type="range"
              min={game.minMemory}
              max={game.maxMemory}
              step={1024}
              value={form.memoryMb}
              onChange={(e) => setForm({ ...form, memoryMb: Number(e.target.value) })}
              className="w-full"
              style={{ ["--accent" as never]: accent, ["--fill" as never]: `${((form.memoryMb - game.minMemory) / (game.maxMemory - game.minMemory)) * 100}%` }}
            />
          </Field>
          <p className="mt-3 text-[11.5px] leading-relaxed text-plum-500">
            This is the process memory limit passed to runtimes that support it. Make sure your PC has enough free RAM for every running server.
          </p>
        </section>

        {/* save card */}
        <section className="panel sticky top-6 p-5" style={dirty ? { borderColor: hexA(accent, 0.35) } : undefined}>
          <div className="flex items-center gap-3">
            <div className="mr-auto">
              <p className="text-[13.5px] font-semibold text-plum-900">{dirty ? "Unsaved changes" : savedAt ? "All changes saved" : "Configuration"}</p>
              <p className="text-[11.5px] text-plum-500">
                {initial.status === "online" ? "Server is online — a restart is required to apply." : "Applies next boot."}
              </p>
            </div>
            {savedAt && !dirty && <Check size={16} className="text-emerald-600" />}
            <Btn variant="primary" accent={accent} disabled={!dirty} loading={saving} onClick={save}>
              <Save size={14} /> Save config
            </Btn>
          </div>
          {err && <p className="mt-3 text-[12px] text-red-500">{err}</p>}
        </section>

        {/* danger zone */}
        <section className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <h3 className="font-display mb-2 flex items-center gap-2 text-[14px] font-semibold text-red-600">
            <AlertTriangle size={14} /> Danger zone
          </h3>
          <p className="mb-4 text-[12px] leading-relaxed text-plum-500">
            Permanently deletes <span className="text-plum-800">{initial.name}</span>, its backups, logs and schedules. {initial.managedDirectory ? "Managed server files and worlds are also deleted." : "Your external working directory is left untouched."} This cannot be undone.
          </p>
          <div className="flex flex-wrap gap-2">
            <Btn variant="ghost" loading={resettingCredentials} onClick={() => void resetCredentials()}>
              <KeyRound size={14} /> Reset stored credentials
            </Btn>
            <Btn variant="danger" onClick={() => setConfirmDel(true)}>
              <Trash2 size={14} /> Delete server
            </Btn>
          </div>
        </section>
      </div>

      <Modal open={confirmDel} onClose={() => setConfirmDel(false)} title="Delete this server forever?">
        <p className="text-[13.5px] leading-relaxed text-plum-500">
          Type <span className="font-mono font-semibold text-plum-900">{initial.name}</span> to confirm deletion.
        </p>
        <input className={cn(inputCls, "mt-4 font-mono")} value={delName} onChange={(e) => setDelName(e.target.value)} placeholder={initial.name} />
        <div className="mt-5 flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => setConfirmDel(false)}>Cancel</Btn>
          <Btn variant="danger" disabled={delName !== initial.name} loading={deleting} onClick={destroy}>
            <Trash2 size={14} /> Delete permanently
          </Btn>
        </div>
      </Modal>
    </div>
  );
}

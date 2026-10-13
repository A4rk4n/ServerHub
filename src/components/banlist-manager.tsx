"use client";

import { Gavel, Globe, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Btn, Spin, inputCls } from "./ui";

type BanlistData = {
  supported: boolean;
  live?: boolean;
  bans?: { name: string; reason: string; source: string; created: string }[];
  ipBans?: { ip: string; reason: string; source: string; created: string }[];
};

export function BanlistManager({ serverId, accent }: { serverId: number; accent: string }) {
  const [data, setData] = useState<BanlistData | null>(null);
  const [banName, setBanName] = useState("");
  const [banIp, setBanIp] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/servers/${serverId}/banlist`, { cache: "no-store" });
      setData(await r.json());
    } catch {
      setData({ supported: false });
    }
  }, [serverId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: string, target: string) {
    setBusy(`${action}:${target}`);
    setError(null);
    try {
      const payload: Record<string, string> = { action, reason };
      if (action === "ban-ip" || action === "pardon-ip") payload.ip = target;
      else payload.name = target;
      const r = await fetch(`/api/servers/${serverId}/banlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.error ?? `Request failed (HTTP ${r.status})`);
        return;
      }
      if (action === "ban") setBanName("");
      if (action === "ban-ip") setBanIp("");
      // Console-mode changes land in the files a moment later.
      if (j.mode === "console") await new Promise((resolve) => setTimeout(resolve, 1200));
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  if (!data) return <Spin label="Reading ban lists…" />;
  if (!data.supported) return null;

  const bans = data.bans ?? [];
  const ipBans = data.ipBans ?? [];

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-candy-200/70 px-4 py-3">
        <Gavel size={14} style={{ color: accent }} />
        <h3 className="font-display text-[13px] font-semibold text-plum-900">Ban lists</h3>
        <span className="text-[11px] text-plum-400">
          {data.live ? "applied through the live console" : "edits the ban files directly while the server is offline"}
        </span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional, recorded with new bans)…"
          className={`${inputCls} ml-auto w-64 max-w-full`}
        />
      </div>
      {error && <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-[12px] font-semibold text-red-600">{error}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2">
        <section className="border-b border-candy-200/70 p-4 md:border-b-0 md:border-r">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-plum-400">
            <Gavel size={12} /> Banned players <span className="font-mono">{bans.length}</span>
          </div>
          <ul className="space-y-1.5">
            {bans.length === 0 && <li className="text-[12px] text-plum-400">Nobody is banned.</li>}
            {bans.map((entry) => (
              <li key={entry.name} className="flex items-center gap-2 rounded-lg bg-candy-50 px-2.5 py-1.5">
                <span className="text-[12.5px] font-semibold text-plum-800">{entry.name}</span>
                <span className="truncate text-[11px] text-plum-400" title={`${entry.reason} — ${entry.source}, ${entry.created}`}>
                  {entry.reason}
                </span>
                <button
                  className="ml-auto rounded p-1 text-plum-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  disabled={busy !== null}
                  onClick={() => void run("pardon", entry.name)}
                  title={`Pardon ${entry.name}`}
                >
                  {busy === `pardon:${entry.name}` ? <Spin /> : <X size={13} />}
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (banName.trim()) void run("ban", banName.trim());
            }}
          >
            <input value={banName} onChange={(e) => setBanName(e.target.value)} placeholder="Player to ban…" className={`${inputCls} flex-1`} />
            <Btn size="sm" variant="danger" type="submit" disabled={!banName.trim() || busy !== null} loading={busy === `ban:${banName.trim()}`}>
              Ban
            </Btn>
          </form>
        </section>
        <section className="p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-plum-400">
            <Globe size={12} /> Banned IPs <span className="font-mono">{ipBans.length}</span>
          </div>
          <ul className="space-y-1.5">
            {ipBans.length === 0 && <li className="text-[12px] text-plum-400">No IP bans.</li>}
            {ipBans.map((entry) => (
              <li key={entry.ip} className="flex items-center gap-2 rounded-lg bg-candy-50 px-2.5 py-1.5">
                <span className="font-mono text-[12.5px] font-semibold text-plum-800">{entry.ip}</span>
                <span className="truncate text-[11px] text-plum-400" title={`${entry.reason} — ${entry.source}, ${entry.created}`}>
                  {entry.reason}
                </span>
                <button
                  className="ml-auto rounded p-1 text-plum-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  disabled={busy !== null}
                  onClick={() => void run("pardon-ip", entry.ip)}
                  title={`Unban ${entry.ip}`}
                >
                  {busy === `pardon-ip:${entry.ip}` ? <Spin /> : <X size={13} />}
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (banIp.trim()) void run("ban-ip", banIp.trim());
            }}
          >
            <input value={banIp} onChange={(e) => setBanIp(e.target.value)} placeholder="IP address to ban…" className={`${inputCls} flex-1 font-mono`} />
            <Btn size="sm" variant="danger" type="submit" disabled={!banIp.trim() || busy !== null} loading={busy === `ban-ip:${banIp.trim()}`}>
              Ban IP
            </Btn>
          </form>
        </section>
      </div>
    </div>
  );
}

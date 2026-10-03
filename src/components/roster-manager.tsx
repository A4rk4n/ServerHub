"use client";

import { AlertTriangle, Crown, ShieldCheck, ShieldOff, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { hexA } from "@/lib/format";
import { Btn, Spin } from "./ui";

type RosterData = {
  supported: boolean;
  live?: boolean;
  whitelist?: { uuid: string; name: string }[];
  ops?: { uuid: string; name: string; level: number }[];
  whitelistEnabled?: boolean | null;
  knownPlayers?: string[];
};

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

export function RosterManager({ serverId, accent }: { serverId: number; accent: string }) {
  const [data, setData] = useState<RosterData | null>(null);
  const [whitelistName, setWhitelistName] = useState("");
  const [opName, setOpName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/servers/${serverId}/roster`, { cache: "no-store" });
      setData(await r.json());
    } catch {
      setData({ supported: false });
    }
  }, [serverId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: string, name?: string) {
    setBusy(`${action}:${name ?? ""}`);
    setError(null);
    try {
      const r = await fetch(`/api/servers/${serverId}/roster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, name }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.error ?? `Request failed (HTTP ${r.status})`);
        return;
      }
      if (action === "whitelist-add") setWhitelistName("");
      if (action === "op") setOpName("");
      // Console-mode changes land in the files a moment later.
      if (j.mode === "console") await new Promise((resolve) => setTimeout(resolve, 1200));
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  if (!data) return <Spin label="Reading roster…" />;
  if (!data.supported) return null;

  const enabled = data.whitelistEnabled === true;
  const suggestions = data.knownPlayers ?? [];

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-candy-200/70 px-4 py-3">
        <ShieldCheck size={15} style={{ color: accent }} />
        <p className="font-display text-[13.5px] font-semibold text-plum-900">Whitelist &amp; operators</p>
        <span className="text-[11px] text-plum-400">
          {data.live ? "server online — applied instantly via console" : "server offline — editing roster files directly"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] font-medium text-plum-500">Whitelist {data.whitelistEnabled === null ? "not configured" : enabled ? "enforced" : "off"}</span>
          <Btn size="sm" variant={enabled ? "primary" : undefined} accent={accent} loading={busy?.startsWith("whitelist-o") ?? false} onClick={() => void run(enabled ? "whitelist-off" : "whitelist-on")}>
            {enabled ? <ShieldOff size={12} /> : <ShieldCheck size={12} />} {enabled ? "Disable" : "Enable"}
          </Btn>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-1.5 border-b border-candy-200/70 bg-rose-50 px-4 py-1.5 text-[11px] text-rose-600">
          <AlertTriangle size={11} /> {error}
        </div>
      )}

      <div className="grid gap-0 md:grid-cols-2">
        <RosterColumn
          title="Whitelisted players"
          icon={<ShieldCheck size={13} style={{ color: accent }} />}
          entries={(data.whitelist ?? []).map((e) => ({ name: e.name }))}
          empty="Nobody is whitelisted yet."
          input={whitelistName}
          setInput={setWhitelistName}
          placeholder="Player name…"
          addLabel="Whitelist"
          suggestions={suggestions}
          listId={`wl-suggest-${serverId}`}
          accent={accent}
          busy={busy}
          addAction="whitelist-add"
          removeAction="whitelist-remove"
          onRun={run}
          className="border-b border-candy-200/70 md:border-b-0 md:border-r"
        />
        <RosterColumn
          title="Operators"
          icon={<Crown size={13} style={{ color: accent }} />}
          entries={(data.ops ?? []).map((e) => ({ name: e.name, badge: `level ${e.level}` }))}
          empty="No operators configured."
          input={opName}
          setInput={setOpName}
          placeholder="Player to promote…"
          addLabel="Promote"
          suggestions={suggestions}
          listId={`op-suggest-${serverId}`}
          accent={accent}
          busy={busy}
          addAction="op"
          removeAction="deop"
          onRun={run}
        />
      </div>
    </div>
  );
}

function RosterColumn({
  title,
  icon,
  entries,
  empty,
  input,
  setInput,
  placeholder,
  addLabel,
  suggestions,
  listId,
  accent,
  busy,
  addAction,
  removeAction,
  onRun,
  className,
}: {
  title: string;
  icon: React.ReactNode;
  entries: { name: string; badge?: string }[];
  empty: string;
  input: string;
  setInput: (v: string) => void;
  placeholder: string;
  addLabel: string;
  suggestions: string[];
  listId: string;
  accent: string;
  busy: string | null;
  addAction: string;
  removeAction: string;
  onRun: (action: string, name?: string) => Promise<void>;
  className?: string;
}) {
  const valid = NAME_RE.test(input.trim());
  return (
    <div className={`p-4 ${className ?? ""}`}>
      <div className="mb-2.5 flex items-center gap-1.5">
        {icon}
        <p className="text-[12.5px] font-semibold text-plum-800">{title}</p>
        <span className="text-[10.5px] text-plum-400">{entries.length}</span>
      </div>
      <form
        className="mb-3 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void onRun(addAction, input.trim());
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          list={listId}
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-candy-200/80 bg-white px-2.5 py-1.5 font-mono text-[12px] text-plum-800 outline-none focus:border-candy-300"
        />
        <datalist id={listId}>
          {suggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <Btn size="sm" variant="primary" accent={accent} disabled={!valid} loading={busy === `${addAction}:${input.trim()}`}>
          <UserPlus size={12} /> {addLabel}
        </Btn>
      </form>
      {entries.length === 0 ? (
        <p className="rounded-lg bg-candy-50 px-3 py-2.5 text-[11.5px] text-plum-400">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {entries.map((entry) => (
            <li key={entry.name} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ background: hexA(accent, 0.06) }}>
              <span className="font-mono text-[12px] text-plum-800">{entry.name}</span>
              {entry.badge && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-amber-600">{entry.badge}</span>}
              <button
                className="ml-auto rounded p-1 text-plum-400 transition hover:bg-rose-50 hover:text-rose-500"
                title={`Remove ${entry.name}`}
                disabled={busy === `${removeAction}:${entry.name}`}
                onClick={() => void onRun(removeAction, entry.name)}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

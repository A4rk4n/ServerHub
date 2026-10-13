"use client";

import { Gamepad2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Btn, Spin, Toggle, inputCls } from "./ui";

type Field =
  | { key: string; label: string; hint: string; type: "enum"; options: string[]; value: string }
  | { key: string; label: string; hint: string; type: "boolean"; value: boolean }
  | { key: string; label: string; hint: string; type: "integer"; min: number; max: number; value: number };

export function GameSettingsPanel({ serverId, accent, status }: { serverId: number; accent: string; status: string }) {
  const [fields, setFields] = useState<Field[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await fetch(`/api/servers/${serverId}/game-settings`, { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { fields: Field[] };
      if (live) setFields(j.fields);
    })();
    return () => { live = false; };
  }, [serverId]);

  function update(key: string, value: string | number | boolean) {
    setFields((prev) => prev?.map((f) => (f.key === key ? ({ ...f, value } as Field) : f)) ?? prev);
    setDirty(true);
    setNote(null);
  }

  async function save() {
    if (!fields) return;
    setSaving(true);
    try {
      const values = Object.fromEntries(fields.map((f) => [f.key, f.value]));
      const r = await fetch(`/api/servers/${serverId}/game-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setNote(j.error ?? "Save failed");
      } else {
        setDirty(false);
        setNote(status === "online" ? "Saved — changes apply on the next restart." : "Saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel p-5">
      <div className="mb-1 flex items-center gap-2">
        <Gamepad2 size={15} style={{ color: accent }} />
        <h3 className="font-display text-[13.5px] font-semibold text-plum-900">Gameplay settings</h3>
      </div>
      <p className="mb-4 text-[12px] text-plum-500">
        Curated server.properties options — everything else in the file is left untouched. Name, port, MOTD, difficulty,
        PvP and player cap live in the server settings above.
      </p>
      {!fields ? (
        <Spin />
      ) : (
        <>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.key} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold text-plum-800">{f.label}</p>
                  <p className="text-[11px] leading-snug text-plum-400">{f.hint}</p>
                </div>
                {f.type === "boolean" ? (
                  <Toggle checked={f.value} onChange={(v) => update(f.key, v)} accent={accent} />
                ) : f.type === "enum" ? (
                  <select className={inputCls + " !w-32 shrink-0"} value={f.value} onChange={(e) => update(f.key, e.target.value)}>
                    {f.options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    className={inputCls + " !w-24 shrink-0"}
                    min={f.min}
                    max={f.max}
                    value={f.value}
                    onChange={(e) => update(f.key, Number(e.target.value))}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Btn variant="primary" accent={accent} disabled={!dirty} loading={saving} onClick={() => void save()}>
              Save gameplay settings
            </Btn>
            {note && <span className="text-[12px] font-semibold text-plum-600">{note}</span>}
          </div>
        </>
      )}
    </div>
  );
}

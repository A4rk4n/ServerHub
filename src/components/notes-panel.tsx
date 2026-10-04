"use client";

import { NotebookPen } from "lucide-react";
import { useEffect, useState } from "react";
import { Btn, Spin } from "./ui";
import { timeAgo } from "@/lib/format";

const MAX = 20_000;

export function NotesPanel({ serverId }: { serverId: number }) {
  const [text, setText] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [savedText, setSavedText] = useState("");

  useEffect(() => {
    void fetch(`/api/servers/${serverId}/notes`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        setSavedText(j.text ?? "");
        setText(j.text ?? "");
        setUpdatedAt(j.updatedAt ?? null);
      })
      .catch(() => setText(""));
  }, [serverId]);

  async function save() {
    if (text === null) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await fetch(`/api/servers/${serverId}/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = await r.json();
      if (!r.ok) return setNotice({ text: j.error ?? "Could not save the notes.", ok: false });
      setSavedText(j.text ?? "");
      setText(j.text ?? "");
      setUpdatedAt(j.updatedAt ?? null);
      setNotice({ text: "Notes saved.", ok: true });
    } catch {
      setNotice({ text: "Could not save the notes.", ok: false });
    } finally {
      setBusy(false);
    }
  }

  if (text === null) return <section className="panel p-5"><Spin label="Loading notes…" /></section>;

  const dirty = text !== savedText;

  return (
    <section className="panel p-5">
      <h3 className="mb-1 flex items-center gap-2 font-semibold">
        <NotebookPen size={15} className="text-plum-500" /> Notes &amp; runbook
      </h3>
      <p className="mb-3 text-sm text-plum-500">
        Free-form notes that live with this server — launch quirks, mod install order, restore steps, who to ping when it breaks.
        Plain text, stored locally, never sent anywhere.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX))}
        rows={Math.min(16, Math.max(5, text.split("\n").length + 1))}
        placeholder={"e.g.\n- Needs 20 min after boot before first backup\n- World seed: …\n- If it crash-loops: disable mod X first"}
        className="w-full resize-y rounded-xl border border-candy-200 bg-white/70 px-3 py-2 font-mono text-[12.5px] leading-relaxed text-plum-800 outline-none transition focus:border-candy-400"
      />
      <div className="mt-2 flex items-center gap-3">
        <Btn variant="primary" loading={busy} disabled={!dirty} onClick={() => void save()}>Save notes</Btn>
        {notice && <span className={`text-xs ${notice.ok ? "text-emerald-600" : "text-red-500"}`}>{notice.text}</span>}
        <span className="ml-auto text-xs text-plum-400">
          {text.length.toLocaleString()}/{MAX.toLocaleString()}
          {updatedAt ? ` · edited ${timeAgo(updatedAt)}` : ""}
        </span>
      </div>
    </section>
  );
}

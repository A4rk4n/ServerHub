"use client";

import { Tags, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Btn, Spin, inputCls } from "./ui";

export function TagsEditor({ serverId, accent }: { serverId: number; accent: string }) {
  const [tags, setTags] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/servers/${serverId}/tags`, { cache: "no-store" });
      const j = await r.json();
      setTags(Array.isArray(j.tags) ? j.tags : []);
    } catch {
      setTags([]);
    }
  }, [serverId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(t);
  }, [notice]);

  if (!tags) return <Spin label="Loading tags…" />;

  async function save(next: string[]) {
    setBusy(true);
    try {
      const r = await fetch(`/api/servers/${serverId}/tags`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: next }),
      });
      const j = await r.json();
      if (r.ok) {
        setTags(j.tags);
        setNotice({ text: "Tags saved", ok: true });
      } else {
        setNotice({ text: j.error ?? "Save failed", ok: false });
      }
    } finally {
      setBusy(false);
    }
  }

  function addTag() {
    const text = draft.trim();
    if (!text || !tags) return;
    setDraft("");
    void save([...tags, text]);
  }

  return (
    <div className="panel p-5">
      <div className="mb-1 flex items-center gap-2">
        <Tags size={15} style={{ color: accent }} />
        <h3 className="font-display text-[13.5px] font-semibold text-plum-900">Tags</h3>
      </div>
      <p className="mb-3 text-[12px] text-plum-500">
        Label this server (“production”, “events”, “testing”) and filter the fleet page by tag — bulk power actions apply to whatever the
        filter shows. Up to 8 tags, lower-case letters, digits, spaces, dashes.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.length === 0 && <span className="text-[12px] text-plum-400">No tags yet.</span>}
        {tags.map((tag) => (
          <span key={tag} className="flex items-center gap-1 rounded-full border border-candy-200 bg-candy-50 px-2.5 py-1 text-[12px] font-semibold text-plum-600">
            #{tag}
            <button
              onClick={() => void save(tags.filter((t) => t !== tag))}
              className="rounded-full p-0.5 text-plum-300 transition hover:bg-rose-50 hover:text-rose-500"
              aria-label={`Remove tag ${tag}`}
            >
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addTag(); }}
          placeholder="Add a tag…"
          maxLength={24}
          className={`${inputCls} w-52`}
          spellCheck={false}
        />
        <Btn variant="primary" accent={accent} onClick={addTag} loading={busy} disabled={tags.length >= 8}>
          Add tag
        </Btn>
        {notice && <span className={`text-[12px] font-semibold ${notice.ok ? "text-emerald-600" : "text-rose-500"}`}>{notice.text}</span>}
      </div>
    </div>
  );
}

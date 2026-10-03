"use client";

import { AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronRight, FileText, Folder, FolderOpen, FolderTree, History, Lock, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { diffLines, detectConfigFormat, validateConfig } from "@/lib/config-editor";
import { cn, hexA } from "@/lib/format";
import { Btn, Modal, Spin } from "./ui";

type FsNode = { name: string; path: string; type: "dir" | "file"; size?: number; editable?: boolean; children?: FsNode[] };

function fmtKb(kb: number) {
  if (kb >= 1024 * 1024) return `${(kb / (1024 * 1024)).toFixed(2)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
}

export function FilesManager({ serverId, accent, status }: { serverId: number; accent: string; status: string }) {
  const [tree, setTree] = useState<FsNode[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["mods", "plugins", "logs", "world"]));
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [saved, setSavedContent] = useState("");
  const [editable, setEditable] = useState(true);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editedBadge, setEditedBadge] = useState(false);
  const [preview, setPreview] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [safetyCopy, setSafetyCopy] = useState<string | null>(null);

  const refreshTree = useCallback(async () => {
    try {
      const r = await fetch(`/api/servers/${serverId}/files`, { cache: "no-store" });
      const j = await r.json();
      setTree(j.tree ?? []);
    } catch {
      setTree([]);
    }
  }, [serverId]);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  const openFile = useCallback(
    async (path: string) => {
      setSelected(path);
      setLoadingFile(true);
      try {
        const r = await fetch(`/api/servers/${serverId}/files?path=${encodeURIComponent(path)}`, { cache: "no-store" });
        const j = await r.json();
        setContent(j.content ?? "");
        setSavedContent(j.content ?? "");
        setEditable(Boolean(j.editable));
        setEditedBadge(Boolean(j.edited));
        setSaveError(null);
        setSafetyCopy(null);
      } finally {
        setLoadingFile(false);
      }
    },
    [serverId]
  );

  async function save(force: boolean) {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch(`/api/servers/${serverId}/files`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selected, content, force }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setSaveError(j.error ?? `Save failed (HTTP ${r.status})`);
        return;
      }
      setSavedContent(content);
      setEditedBadge(true);
      setPreview(false);
      setSafetyCopy(j.safetyCopy ?? null);
      if (j.safetyCopy) void refreshTree();
    } finally {
      setSaving(false);
    }
  }

  const dirty = content !== saved;
  const format = useMemo(() => (selected ? detectConfigFormat(selected) : null), [selected]);
  const verdict = useMemo(() => (format ? validateConfig(format, content) : null), [format, content]);
  const diff = useMemo(() => (preview ? diffLines(saved, content) : null), [preview, saved, content]);

  if (!tree) return <Spin label="Reading filesystem…" />;

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-candy-200/70 px-4 py-3">
        <FolderTree size={15} style={{ color: accent }} />
        <p className="font-display text-[13.5px] font-semibold text-plum-900">File manager</p>
        <span className="text-[11px] text-plum-400">live server directory</span>
        {status === "online" && (
          <span className="ml-auto rounded-md bg-amber-100 px-2 py-1 text-[10.5px] font-medium text-amber-500">config changes apply on restart</span>
        )}
      </div>
      <div className="grid min-h-[560px] md:grid-cols-[280px_1fr]">
        {/* tree */}
        <div className="overflow-y-auto border-b border-candy-200/70 bg-candy-50 p-2.5 max-md:max-h-64 md:border-b-0 md:border-r">
          {tree.map((n) => (
            <Node key={n.path} node={n} depth={0} expanded={expanded} setExpanded={setExpanded} selected={selected} onOpen={openFile} accent={accent} />
          ))}
        </div>

        {/* editor */}
        <div className="flex min-w-0 flex-col">
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-plum-400">
              <FileText size={26} className="mb-1 opacity-60" />
              <p className="text-[13px]">Select a file to inspect or edit it</p>
              <p className="max-w-xs text-[11.5px]">Live world data (worlds, jars, saves) is locked — config files are fully editable.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-candy-200/70 px-4 py-2.5">
                <p className="min-w-0 truncate font-mono text-[12px] text-plum-700">{selected}</p>
                {editedBadge && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-sky-600">modified</span>}
                {!editable && (
                  <span className="flex items-center gap-1 rounded bg-candy-50 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-plum-500">
                    <Lock size={9} /> read-only
                  </span>
                )}
                <div className="ml-auto flex items-center gap-2">
                  {verdict && editable && (
                    verdict.ok ? (
                      <span className="flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
                        <CheckCircle2 size={10} /> {format} valid
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600" title={verdict.message}>
                        <AlertTriangle size={10} /> {verdict.line ? `line ${verdict.line}: ` : ""}{verdict.message}
                      </span>
                    )
                  )}
                  {dirty && <span className="text-[10.5px] font-medium text-amber-500">unsaved changes</span>}
                  <Btn size="sm" variant="primary" accent={accent} disabled={!dirty || !editable} onClick={() => (format ? setPreview(true) : void save(false))} loading={saving}>
                    <Save size={12} /> {format ? "Review & save" : "Save"}
                  </Btn>
                </div>
              </div>
              {safetyCopy && !dirty && (
                <div className="flex items-center gap-1.5 border-b border-candy-200/70 bg-sky-50 px-4 py-1.5 text-[11px] text-sky-700">
                  <History size={11} /> Saved. Previous version kept as <span className="font-mono">{safetyCopy}</span>
                </div>
              )}
              {saveError && !preview && (
                <div className="flex items-center gap-1.5 border-b border-candy-200/70 bg-rose-50 px-4 py-1.5 text-[11px] text-rose-600">
                  <AlertTriangle size={11} /> {saveError}
                </div>
              )}
              {loadingFile ? (
                <Spin label={`Loading ${selected}…`} />
              ) : editable ? (
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  spellCheck={false}
                  className="min-h-[460px] flex-1 resize-none bg-transparent p-4 font-mono text-[12px] leading-[1.7] text-plum-800 outline-none"
                />
              ) : (
                <pre className="max-h-[460px] flex-1 overflow-auto p-4 font-mono text-[12px] leading-[1.7] text-plum-500">{content || "(binary file)"}</pre>
              )}
            </>
          )}
        </div>
      </div>

      <Modal open={preview} onClose={() => setPreview(false)} title={`Review changes — ${selected ?? ""}`} wide>
        {diff && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="rounded bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-600">+{diff.added} added</span>
              <span className="rounded bg-rose-50 px-2 py-0.5 font-semibold text-rose-600">−{diff.removed} removed</span>
              <span className="text-plum-400">from line {diff.start}</span>
              <span className="ml-auto flex items-center gap-1 text-[11px] text-plum-400">
                <History size={11} /> a safety copy of the current file is kept automatically
              </span>
            </div>
            <div className="max-h-[320px] overflow-auto rounded-xl border border-candy-200/70 bg-candy-50 p-3 font-mono text-[11.5px] leading-[1.65]">
              {diff.contextBefore.map((l, i) => (
                <div key={`cb${i}`} className="whitespace-pre-wrap text-plum-400">  {l}</div>
              ))}
              {diff.removedLines.map((l, i) => (
                <div key={`rm${i}`} className="whitespace-pre-wrap bg-rose-50 text-rose-600">− {l}</div>
              ))}
              {diff.addedLines.map((l, i) => (
                <div key={`ad${i}`} className="whitespace-pre-wrap bg-emerald-50 text-emerald-700">+ {l}</div>
              ))}
              {diff.contextAfter.map((l, i) => (
                <div key={`ca${i}`} className="whitespace-pre-wrap text-plum-400">  {l}</div>
              ))}
            </div>
            {verdict && !verdict.ok && (
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>
                  This file does not pass {format} validation{verdict.line ? ` (line ${verdict.line})` : ""}: {verdict.message}. You can still save it, but the
                  server may fail to read it.
                </span>
              </div>
            )}
            {saveError && (
              <div className="flex items-center gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-[12px] text-rose-600">
                <AlertTriangle size={12} /> {saveError}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Btn size="sm" onClick={() => setPreview(false)}>Keep editing</Btn>
              <Btn size="sm" variant="primary" accent={accent} loading={saving} onClick={() => void save(Boolean(verdict && !verdict.ok))}>
                <Save size={12} /> {verdict && !verdict.ok ? "Save anyway" : "Confirm save"}
              </Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Node({
  node,
  depth,
  expanded,
  setExpanded,
  selected,
  onOpen,
  accent,
}: {
  node: FsNode;
  depth: number;
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  selected: string | null;
  onOpen: (p: string) => void;
  accent: string;
}) {
  const isOpen = expanded.has(node.path);
  if (node.type === "dir") {
    return (
      <div>
        <button
          onClick={() =>
            setExpanded((prev) => {
              const n = new Set(prev);
              if (n.has(node.path)) n.delete(node.path);
              else n.add(node.path);
              return n;
            })
          }
          className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] font-medium text-plum-700 transition hover:bg-candy-100"
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {isOpen ? <ChevronDown size={13} className="shrink-0 text-plum-400" /> : <ChevronRight size={13} className="shrink-0 text-plum-400" />}
          {isOpen ? <FolderOpen size={14} style={{ color: accent }} /> : <Folder size={14} style={{ color: hexA(accent, 0.75) }} />}
          <span className="truncate">{node.name}</span>
        </button>
        {isOpen &&
          node.children?.map((c) => (
            <Node key={c.path} node={c} depth={depth + 1} expanded={expanded} setExpanded={setExpanded} selected={selected} onOpen={onOpen} accent={accent} />
          ))}
      </div>
    );
  }
  const active = selected === node.path;
  return (
    <button
      onClick={() => onOpen(node.path)}
      className={cn("flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] transition", active ? "text-plum-900" : "text-plum-500 hover:bg-candy-100 hover:text-plum-800")}
      style={{ paddingLeft: 8 + depth * 14 + 15, background: active ? hexA(accent, 0.1) : undefined }}
    >
      {node.editable ? <FileText size={13} className="shrink-0 text-plum-500" /> : <Lock size={11} className="shrink-0 text-plum-400" />}
      <span className="truncate font-mono">{node.name}</span>
      {node.size !== undefined && <span className="ml-auto shrink-0 pl-2 font-mono text-[9.5px] text-plum-400">{fmtKb(node.size)}</span>}
      {active && <Check size={11} style={{ color: accent }} className="shrink-0" />}
    </button>
  );
}

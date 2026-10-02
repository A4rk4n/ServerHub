"use client";

import { Download, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Btn } from "./ui";

export function PanelSettingsPanel() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  async function exportBundle() {
    setBusy("export");
    try {
      const r = await fetch("/api/panel-settings", { cache: "no-store" });
      if (!r.ok) throw new Error("Export failed");
      const name = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? "serverhub-panel-settings.json";
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      setNotice({ text: "Settings bundle downloaded — it contains your webhook URL and status token, store it safely", ok: true });
    } catch {
      setNotice({ text: "Export failed", ok: false });
    } finally {
      setBusy(null);
    }
  }

  async function importBundle(file: File) {
    setBusy("import");
    try {
      const text = await file.text();
      const r = await fetch("/api/panel-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setNotice({ text: `Imported ${j.applied.length} section${j.applied.length === 1 ? "" : "s"}: ${j.applied.join(", ")} ✓`, ok: true });
      } else {
        setNotice({ text: j.error ?? "Import failed", ok: false });
      }
    } catch {
      setNotice({ text: "Import failed — is this a settings bundle?", ok: false });
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="panel p-5">
      <div className="mb-1 flex items-center gap-2">
        <Download size={15} className="text-plum-500" />
        <h3 className="font-display text-[13.5px] font-semibold text-plum-900">Panel settings backup</h3>
      </div>
      <p className="mb-3 text-[12px] text-plum-500">
        Export every panel-level setting — notifications, disk alerts, log retention, restart warnings, announcements, tags, status page,
        backup mirror — as one JSON bundle for backups or moving to a new machine. The PIN lock is never included; per-server settings
        apply by server ID, so import on a panel with matching servers. The bundle contains your webhook URL and status token — treat it
        like a secret.
      </p>
      <div className="flex flex-wrap items-center gap-2.5">
        <Btn variant="primary" onClick={() => void exportBundle()} loading={busy === "export"}>
          <Download size={13} /> Download bundle
        </Btn>
        <Btn variant="subtle" onClick={() => fileInput.current?.click()} loading={busy === "import"}>
          <Upload size={13} /> Import bundle…
        </Btn>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importBundle(f); }}
        />
        {notice && <span className={`text-[12px] font-semibold ${notice.ok ? "text-emerald-600" : "text-rose-500"}`}>{notice.text}</span>}
      </div>
    </div>
  );
}

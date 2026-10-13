"use client";

import { Lock, LockOpen, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Btn, Field, Spin, inputCls } from "./ui";

export function PinLockPanel() {
  const router = useRouter();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    void fetch("/api/security/pin", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setEnabled(Boolean(j.enabled)))
      .catch(() => setEnabled(false));
  }, []);

  function digitsOnly(value: string) {
    return value.replace(/\D/g, "").slice(0, 12);
  }

  async function save() {
    if (newPin !== confirmPin) return setNotice({ text: "The new PINs do not match.", ok: false });
    if (!/^\d{4,12}$/.test(newPin)) return setNotice({ text: "A PIN is 4 to 12 digits.", ok: false });
    setBusy(true);
    setNotice(null);
    try {
      const r = await fetch("/api/security/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPin, newPin }),
      });
      const j = await r.json();
      if (!r.ok) return setNotice({ text: j.error ?? "Could not save the PIN.", ok: false });
      setEnabled(true);
      setCurrentPin(""); setNewPin(""); setConfirmPin("");
      setNotice({ text: "PIN saved. The panel will ask for it from now on.", ok: true });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!window.confirm("Remove the PIN? Anyone at this PC will be able to open the panel.")) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await fetch("/api/security/pin", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPin }),
      });
      const j = await r.json();
      if (!r.ok) return setNotice({ text: j.error ?? "Could not remove the PIN.", ok: false });
      setEnabled(false);
      setCurrentPin(""); setNewPin(""); setConfirmPin("");
      setNotice({ text: "PIN removed.", ok: true });
    } finally {
      setBusy(false);
    }
  }

  async function lockNow() {
    await fetch("/api/security/pin/lock", { method: "POST" });
    router.push("/lock");
    router.refresh();
  }

  if (enabled === null) return <section className="panel p-5"><Spin label="Loading PIN lock…" /></section>;

  return (
    <section className="panel p-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display flex items-center gap-2 text-[14px] font-semibold text-plum-900">
          <ShieldCheck size={15} className="text-plum-500" /> Panel PIN lock
        </h3>
        {enabled && (
          <Btn size="sm" variant="subtle" onClick={() => void lockNow()}>
            <Lock size={13} /> Lock now
          </Btn>
        )}
      </div>
      <p className="mb-4 text-xs text-plum-500">
        {enabled
          ? "A PIN protects this panel. Unlocks last 12 hours per browser; changing the PIN signs everyone out instantly."
          : "Optional: require a 4–12 digit PIN to open Server Hub, so others at this PC cannot reach your server controls. This is a local convenience lock — the panel still only accepts connections from this computer."}
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        {enabled && (
          <Field label="Current PIN">
            <input className={inputCls} type="password" inputMode="numeric" value={currentPin} onChange={(e) => setCurrentPin(digitsOnly(e.target.value))} placeholder="••••" />
          </Field>
        )}
        <Field label={enabled ? "New PIN" : "PIN (4–12 digits)"}>
          <input className={inputCls} type="password" inputMode="numeric" value={newPin} onChange={(e) => setNewPin(digitsOnly(e.target.value))} placeholder="••••" />
        </Field>
        <Field label={enabled ? "Repeat new PIN" : "Repeat PIN"}>
          <input className={inputCls} type="password" inputMode="numeric" value={confirmPin} onChange={(e) => setConfirmPin(digitsOnly(e.target.value))} placeholder="••••" />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Btn variant="primary" loading={busy} disabled={!newPin} onClick={() => void save()}>
          {enabled ? "Change PIN" : "Enable PIN lock"}
        </Btn>
        {enabled && (
          <Btn variant="subtle" loading={busy} disabled={!currentPin} onClick={() => void disable()}>
            <LockOpen size={13} /> Remove PIN
          </Btn>
        )}
        {notice && <span className={`text-xs ${notice.ok ? "text-emerald-600" : "text-red-500"}`}>{notice.text}</span>}
      </div>
    </section>
  );
}

"use client";

import { Lock } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LockScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryInMs, setRetryInMs] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // Already unlocked (or no PIN configured)? Go straight in.
    void fetch("/api/security/pin/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j.locked) router.replace(params.get("next") || "/");
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (retryInMs <= 0) return;
    const timer = setInterval(() => setRetryInMs((value) => Math.max(0, value - 1000)), 1000);
    return () => clearInterval(timer);
  }, [retryInMs]);

  async function unlock() {
    if (!pin || busy || retryInMs > 0) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/security/pin/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const j = await r.json();
      if (r.ok) {
        router.replace(params.get("next") || "/");
        return;
      }
      setPin("");
      if (j.retryInMs) {
        setRetryInMs(j.retryInMs);
        setError("Too many wrong PINs.");
      } else {
        setError(typeof j.attemptsLeft === "number" ? `Wrong PIN — ${j.attemptsLeft} attempts left.` : j.error ?? "Wrong PIN.");
      }
      inputRef.current?.focus();
    } catch {
      setError("Could not reach Server Hub.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-candy-50 via-white to-candy-100 p-6">
      <div className="panel w-full max-w-sm p-8 text-center">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-candy-100 text-plum-700">
          <Lock size={24} />
        </span>
        <h1 className="font-display text-xl font-bold text-plum-900">Server Hub is locked</h1>
        <p className="mt-1 text-[13px] text-plum-500">Enter your PIN to open the panel.</p>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          maxLength={12}
          disabled={busy || retryInMs > 0}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter") void unlock(); }}
          placeholder="••••"
          className="mt-5 w-full rounded-xl border border-candy-200 bg-white px-4 py-3 text-center font-mono text-xl tracking-[0.5em] text-plum-900 outline-none focus:border-candy-400"
        />
        {error && <p className="mt-3 text-xs text-red-500">{error}{retryInMs > 0 ? ` Try again in ${Math.ceil(retryInMs / 1000)}s.` : ""}</p>}
        <button
          onClick={() => void unlock()}
          disabled={busy || !pin || retryInMs > 0}
          className="mt-5 w-full rounded-xl bg-plum-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-plum-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Checking…" : retryInMs > 0 ? `Locked for ${Math.ceil(retryInMs / 1000)}s` : "Unlock"}
        </button>
        <p className="mt-4 text-[11px] text-plum-400">Forgot it? Delete pin-lock.json from the Server Hub data folder while the panel is closed.</p>
      </div>
    </main>
  );
}

export default function LockPage() {
  return (
    <Suspense>
      <LockScreen />
    </Suspense>
  );
}

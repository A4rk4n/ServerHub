"use client";

import { ArrowUpCircle, BellOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { shouldShowUpdateBanner } from "@/lib/update-check";

const MUTE_KEY = "serverhub:update-check";
const DISMISS_KEY = "serverhub:update-dismissed";

type UpdateStatus = { current: string; latest: string | null; updateAvailable: boolean; url: string };

// Single fetcher for the update status: the shell uses `current` for the
// sidebar version line and the banner for the notification itself.
export function useUpdateCheck() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [muted, setMuted] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    setMuted(localStorage.getItem(MUTE_KEY) === "off");
    setDismissed(localStorage.getItem(DISMISS_KEY));
    let dead = false;
    (async () => {
      try {
        const r = await fetch("/api/update-check", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (!dead) setStatus(j);
      } catch {}
    })();
    return () => {
      dead = true;
    };
  }, []);

  return {
    status,
    muted,
    showBanner: status !== null && shouldShowUpdateBanner(status, dismissed, muted),
    dismiss: () => {
      if (status?.latest) localStorage.setItem(DISMISS_KEY, status.latest);
      setDismissed(status?.latest ?? null);
    },
    mute: () => {
      localStorage.setItem(MUTE_KEY, "off");
      setMuted(true);
    },
    unmute: () => {
      localStorage.removeItem(MUTE_KEY);
      setMuted(false);
    },
  };
}

export function UpdateBanner({ update }: { update: ReturnType<typeof useUpdateCheck> }) {
  if (!update.showBanner || !update.status) return null;
  const { current, latest, url } = update.status;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-3xl border border-candy-300 bg-gradient-to-r from-candy-50 to-white px-4 py-3 shadow-[0_14px_30px_-18px_rgba(122,45,90,0.4)]">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-white" style={{ background: "linear-gradient(135deg, #ff7ebc, #f43f92)" }}>
        <ArrowUpCircle size={17} />
      </span>
      <p className="min-w-0 flex-1 text-[13px] text-plum-700">
        <span className="font-bold text-plum-900">Server Hub v{latest} is available</span>
        <span className="text-plum-500"> — you are running v{current}. Update at your convenience; servers keep running until you do.</span>
      </p>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="rounded-xl bg-candy-400 px-3.5 py-2 text-[12px] font-bold text-white transition hover:bg-candy-500"
      >
        View release
      </a>
      <button
        onClick={update.mute}
        title="Stop checking for updates (this browser)"
        className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-[11px] font-semibold text-plum-400 transition hover:bg-candy-50 hover:text-plum-700"
      >
        <BellOff size={13} /> Mute
      </button>
      <button
        onClick={update.dismiss}
        title="Dismiss this version"
        aria-label="Dismiss update notification"
        className="rounded-xl p-2 text-plum-400 transition hover:bg-candy-50 hover:text-plum-700"
      >
        <X size={15} />
      </button>
    </div>
  );
}

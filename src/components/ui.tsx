"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn, hexA } from "@/lib/format";

export const STATUS_META: Record<string, { label: string; color: string; pulse: boolean }> = {
  online: { label: "Online", color: "#17ab72", pulse: true },
  offline: { label: "Offline", color: "#a886ad", pulse: false },
  starting: { label: "Starting", color: "#e0a020", pulse: true },
  restarting: { label: "Restart queued", color: "#d18a18", pulse: true },
  stopping: { label: "Stopping", color: "#ef7c30", pulse: true },
  installing: { label: "Installing", color: "#1f9fd6", pulse: true },
  crashed: { label: "Crashed", color: "#e2445c", pulse: false },
  error: { label: "Install failed", color: "#e2445c", pulse: false },
};

export function StatusPill({ status, size = "md" }: { status: string; size?: "sm" | "md" }) {
  const meta = STATUS_META[status] ?? STATUS_META.offline;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-bold uppercase tracking-wider",
        size === "sm" ? "px-2.5 py-1 text-[10px]" : "px-3 py-1 text-[11px]"
      )}
      style={{ color: meta.color, borderColor: hexA(meta.color, 0.28), background: hexA(meta.color, 0.1) }}
    >
      <span className="relative flex h-1.5 w-1.5">
        {meta.pulse && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" style={{ background: meta.color }} />
        )}
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
      </span>
      {meta.label}
    </span>
  );
}

export function Btn({
  children,
  variant = "subtle",
  size = "md",
  className,
  loading,
  accent = "#ff5fa8",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "danger" | "ghost" | "subtle" | "outline";
  size?: "sm" | "md" | "lg" | "icon";
  loading?: boolean;
  accent?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 font-semibold rounded-full transition-all duration-250 disabled:opacity-40 disabled:pointer-events-none select-none whitespace-nowrap active:scale-[0.97]";
  const sizes: Record<string, string> = {
    sm: "text-xs px-3.5 py-2",
    md: "text-[13.5px] px-4.5 py-2.5",
    lg: "text-[15px] px-6 py-3",
    icon: "p-2.5",
  };
  const styles: Record<string, React.CSSProperties> = {
    primary: {
      background: `linear-gradient(135deg, ${hexA(accent, 0.92)}, ${accent})`,
      color: "#fff",
      boxShadow: `0 10px 24px -10px ${hexA(accent, 0.85)}`,
    },
    danger: { background: "#fff1f3", color: "#e2445c", border: "1px solid #ffd2da" },
    ghost: { color: "#744f78" },
    subtle: { background: "#fff", color: "#603c64", border: "1px solid #ffdcee", boxShadow: "0 4px 12px -8px rgba(196,96,156,0.4)" },
    outline: { border: `1.5px solid ${hexA(accent, 0.45)}`, color: accent, background: hexA(accent, 0.07) },
  };
  return (
    <button
      className={cn(base, sizes[size], variant === "ghost" && "hover:bg-candy-50", variant === "subtle" && "hover:border-candy-300", className)}
      style={styles[variant]}
      {...rest}
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : children}
    </button>
  );
}

export function Toggle({ checked, onChange, accent = "#ff5fa8", disabled }: { checked: boolean; onChange: (v: boolean) => void; accent?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative h-[26px] w-[46px] shrink-0 rounded-full transition-all duration-300 disabled:opacity-40", checked ? "" : "bg-candy-200")}
      style={checked ? { background: `linear-gradient(135deg, ${hexA(accent, 0.85)}, ${accent})`, boxShadow: `0 4px 14px -4px ${hexA(accent, 0.7)}` } : undefined}
      aria-pressed={checked}
    >
      <span
        className="absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.18)] transition-all duration-300"
        style={{ left: checked ? 23 : 3 }}
      />
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-plum-900/25 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: 26, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 340, damping: 28 }}
            className={cn("panel relative w-full rounded-[28px] bg-white p-7", wide ? "max-w-2xl" : "max-w-md")}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-[19px] font-bold tracking-tight text-plum-900">{title}</h3>
              <button onClick={onClose} className="rounded-full p-2 text-plum-400 transition hover:bg-candy-50 hover:text-candy-600">
                <X size={16} />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export const inputCls =
  "w-full rounded-2xl border border-candy-200 bg-white px-4 py-2.5 text-sm font-medium text-plum-900 placeholder:text-plum-300 outline-none transition focus:border-candy-400 focus:ring-4 focus:ring-candy-100";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-[13px] font-bold text-plum-700">
        {label}
        {hint && <span className="text-[11px] font-medium text-plum-400">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function Empty({ icon, title, hint, action }: { icon: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[28px] border-2 border-dashed border-candy-200 bg-white/60 px-6 py-16 text-center">
      <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-3xl bg-candy-100 text-candy-500">{icon}</div>
      <p className="font-display text-[16px] font-bold text-plum-900">{title}</p>
      {hint && <p className="max-w-sm text-[13px] text-plum-500">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Spin({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-16 text-sm font-medium text-plum-400">
      <Loader2 size={16} className="animate-spin text-candy-500" />
      {label ?? "Loading…"}
    </div>
  );
}

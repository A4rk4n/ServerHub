"use client";

import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/format";

/**
 * A titled, collapsible group of panels. Children are not mounted until
 * the section is first opened, so collapsed panels fire no fetches —
 * opening a page with many tools stays light.
 */
export function CollapseSection({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [everOpened, setEverOpened] = useState(defaultOpen);

  return (
    <section className="rounded-2xl border border-candy-200/70 bg-white/40">
      <button
        type="button"
        className="flex w-full items-center gap-3 rounded-2xl px-5 py-3.5 text-left transition-colors hover:bg-candy-50/60"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setEverOpened(true);
        }}
      >
        <ChevronRight size={15} className={cn("shrink-0 text-plum-400 transition-transform duration-200", open && "rotate-90")} />
        <span className="font-display text-[13.5px] font-semibold text-plum-900">{title}</span>
        {subtitle && <span className="truncate text-[12px] text-plum-400">{subtitle}</span>}
      </button>
      {everOpened && (
        <div className={cn("space-y-4 px-4 pb-4", !open && "hidden")}>{children}</div>
      )}
    </section>
  );
}

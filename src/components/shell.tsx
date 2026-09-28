"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Boxes, Heart, LayoutDashboard, Plus, Sparkles, Server as ServerIcon } from "lucide-react";
import { cn, hexA } from "@/lib/format";
import { STATUS_META } from "./ui";

type FleetItem = { id: number; name: string; status: string; game: { accent: string; short: string } };

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [fleet, setFleet] = useState<FleetItem[]>([]);

  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const r = await fetch("/api/servers", { cache: "no-store" });
        const j = await r.json();
        if (!dead && j.servers) setFleet(j.servers.slice(0, 5));
      } catch {}
    };
    load();
    const t = setInterval(load, 12000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [pathname]);

  const NAV = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/servers", label: "Servers", icon: Boxes },
    { href: "/servers/new", label: "New Server", icon: Plus, accent: true },
  ];

  return (
    <div className="min-h-screen">
      {/* dreamy background */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="float-slow absolute -top-32 left-[12%] h-[420px] w-[560px] rounded-full opacity-45 blur-[120px]" style={{ background: "radial-gradient(circle, #ffb3dd, transparent 66%)" }} />
        <div className="float-slow absolute top-1/4 -right-24 h-[400px] w-[460px] rounded-full opacity-40 blur-[120px]" style={{ background: "radial-gradient(circle, #d3c4ff, transparent 66%)", animationDelay: "2.5s" }} />
        <div className="float-slow absolute bottom-0 left-1/3 h-[380px] w-[520px] rounded-full opacity-35 blur-[120px]" style={{ background: "radial-gradient(circle, #b8e8ff, transparent 66%)", animationDelay: "4.5s" }} />
        <div className="heart-grid absolute inset-0 opacity-70" style={{ maskImage: "linear-gradient(to bottom, black, transparent 60%)" }} />
      </div>

      {/* floating sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col p-4 md:flex">
        <div className="panel flex h-full flex-col overflow-hidden rounded-[30px] p-0">
          <Link href="/" className="group flex items-center gap-3 px-5 pb-5 pt-6">
            <span
              className="relative flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-[0_8px_20px_-6px_rgba(244,63,146,0.6)] transition-transform duration-300 group-hover:scale-105 group-hover:-rotate-6"
              style={{ background: "linear-gradient(135deg, #ff7ebc, #f43f92)" }}
            >
              <ServerIcon size={19} strokeWidth={2.4} />
              <Sparkles size={11} className="absolute -right-1 -top-1 text-candy-400" fill="currentColor" />
            </span>
            <span className="leading-none">
              <span className="font-display block text-[18px] font-bold tracking-tight text-plum-900">
                Server<span className="grad-text"> Hub</span>
              </span>
              <span className="mt-1.5 block text-[9px] font-bold uppercase tracking-[0.2em] text-plum-400">Command Center</span>
            </span>
          </Link>

          <nav className="flex flex-col gap-1.5 px-3">
            {NAV.map((n) => {
              const isActive =
                n.href === "/"
                  ? pathname === "/"
                  : n.href === "/servers/new"
                    ? pathname === "/servers/new"
                    : pathname.startsWith("/servers") && pathname !== "/servers/new";
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-2xl px-4 py-3 text-[13.5px] font-semibold transition-all duration-300",
                    isActive ? "text-white" : "text-plum-600 hover:bg-candy-50 hover:text-plum-900"
                  )}
                  style={
                    isActive
                      ? { background: "linear-gradient(135deg, #ff7ebc, #f43f92)", boxShadow: "0 10px 22px -10px rgba(244,63,146,0.7)" }
                      : undefined
                  }
                >
                  <n.icon size={16} className={cn("transition", isActive ? "text-white" : "text-candy-500")} />
                  <span>{n.label}</span>
                  {n.accent && !isActive && (
                    <Heart size={11} className="ml-auto text-candy-400 transition group-hover:scale-125" fill="currentColor" />
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="mx-5 my-5 h-px bg-gradient-to-r from-transparent via-candy-200 to-transparent" />

          <div className="flex-1 overflow-hidden px-3">
            <p className="mb-2 flex items-center gap-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-plum-400">
              <Heart size={9} fill="currentColor" className="text-candy-400" /> your fleet
            </p>
            <div className="flex flex-col gap-0.5">
              {fleet.slice(0, 4).map((s) => {
                const meta = STATUS_META[s.status] ?? STATUS_META.offline;
                return (
                  <Link key={s.id} href={`/servers/${s.id}`} className="group flex items-center gap-2.5 rounded-xl px-3 py-2 transition hover:bg-candy-50">
                    <span className="relative h-2 w-2 shrink-0">
                      {meta.pulse && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: meta.color }} />}
                      <span className="relative block h-2 w-2 rounded-full" style={{ background: meta.color }} />
                    </span>
                    <span className="truncate text-[12.5px] font-semibold text-plum-600 transition group-hover:text-plum-900">{s.name}</span>
                    <span className="ml-auto text-[9.5px] font-bold" style={{ color: s.game.accent }}>
                      {s.game.short}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="p-3">
            <div className="rounded-3xl border border-candy-200 bg-gradient-to-br from-candy-50 to-white p-4">
              <div className="flex items-center gap-2 text-[11px] font-bold text-plum-700">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-candy-200 text-candy-600">
                  <Sparkles size={10} />
                </span>
                this PC
              </div>
              <div className="mt-2.5 space-y-1.5 font-mono text-[10px] text-plum-400">
                <p className="flex justify-between"><span>runtime</span><span className="font-semibold text-emerald-600">ready ♡</span></p>
                <p className="flex justify-between"><span>storage</span><span className="text-plum-600">local only</span></p>
                <p className="flex justify-between"><span>network</span><span className="text-plum-600">loopback panel</span></p>
              </div>
            </div>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-[10px] font-medium text-plum-400">
              Server Hub v1.0.2 <Heart size={9} fill="currentColor" className="text-candy-400" /> MIT
            </p>
          </div>
        </div>
      </aside>

      {/* mobile top bar */}
      <div className="sticky top-0 z-40 mx-3 mt-3 flex items-center gap-1 rounded-3xl border border-candy-200 bg-white/85 px-3 py-2.5 backdrop-blur-xl md:hidden">
        <Link href="/" className="mr-2 flex items-center gap-2 pr-1">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl text-white" style={{ background: "linear-gradient(135deg, #ff7ebc, #f43f92)" }}>
            <ServerIcon size={15} />
          </span>
          <span className="font-display text-sm font-bold text-plum-900">Server Hub</span>
        </Link>
        {NAV.map((n) => {
          const isActive =
            n.href === "/" ? pathname === "/" : n.href === "/servers/new" ? pathname === "/servers/new" : pathname.startsWith("/servers") && pathname !== "/servers/new";
          return (
            <Link
              key={n.href}
              href={n.href}
              className={cn("rounded-xl p-2 transition", isActive ? "bg-candy-100 text-candy-600" : "text-plum-400 hover:bg-candy-50")}
            >
              <n.icon size={16} />
            </Link>
          );
        })}
        <Heart size={12} className="ml-auto text-candy-300" fill="currentColor" />
      </div>

      <main className="relative z-10 md:pl-[248px]">
        <div className="mx-auto max-w-[1400px] px-4 pb-24 pt-6 sm:px-7 md:pt-8">{children}</div>
      </main>
    </div>
  );
}

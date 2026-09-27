import clsx from "clsx";

export const cn = clsx;

export function timeAgo(input: Date | string | number | null | undefined): string {
  if (input === null || input === undefined) return "—";
  const d = new Date(input);
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 8) return "just now";
  if (s < 60) return `${Math.floor(s)}s ago`;
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const days = h / 24;
  if (days < 30) return `${Math.floor(days)}d ago`;
  const months = days / 30;
  if (months < 12) return `${Math.floor(months)}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function fmtRam(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb % 1024 >= 100 ? 1 : 0)} GB`;
  return `${mb} MB`;
}

export function fmtUptime(from: Date | string | null | undefined, status: string): string {
  if (!from || status !== "online") return "—";
  const s = Math.max(0, (Date.now() - new Date(from).getTime()) / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function initialAvatarHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

const HEX_RX = /^#([0-9a-f]{6})$/i;
export function hexA(hex: string, alpha: number): string {
  const m = HEX_RX.exec(hex);
  if (!m) return `rgba(255,255,255,${alpha})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}
export function randInt(min: number, max: number) {
  return Math.floor(rand(min, max + 1));
}
export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function uuidLike(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function steam64(): string {
  return "76561198" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
}

export function formatClock(d: Date | string): string {
  const dt = new Date(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
}

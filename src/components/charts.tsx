import { hexA } from "@/lib/format";

function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

export function AreaChart({
  values,
  color,
  height = 150,
  max,
  min = 0,
  id,
  unit = "",
}: {
  values: number[];
  color: string;
  height?: number;
  max?: number;
  min?: number;
  id: string;
  unit?: string;
}) {
  const w = 600;
  const h = height;
  const vmax = max ?? Math.max(...values, 1);
  const pad = 6;
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const pts: [number, number][] = values.map((v, i) => [pad + i * step, h - 4 - ((v - min) / (vmax - min || 1)) * (h - 22)]);
  const line = smoothPath(pts);
  const area = line ? `${line} L ${pts[pts.length - 1][0]},${h} L ${pts[0][0]},${h} Z` : "";
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`g-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.32} />
          <stop offset="100%" stopColor={color} stopOpacity={0.01} />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={pad} x2={w - pad} y1={h * f} y2={h * f} stroke="rgba(244,63,146,0.13)" strokeDasharray="3 6" />
      ))}
      {area && <path d={area} fill={`url(#g-${id})`} />}
      {line && <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />}
      {last && (
        <>
          <circle cx={last[0]} cy={last[1]} r="7" fill={hexA(color, 0.25)} />
          <circle cx={last[0]} cy={last[1]} r="3" fill={color} />
        </>
      )}
      {unit && (
        <text x={w - pad} y={14} textAnchor="end" fill="rgba(168,134,173,0.85)" fontSize="10" fontFamily="monospace">
          {unit}
        </text>
      )}
    </svg>
  );
}

export function Ring({
  value,
  max,
  color,
  size = 92,
  stroke = 9,
  label,
  sub,
}: {
  value: number;
  max: number;
  color: string;
  size?: number;
  stroke?: number;
  label: string;
  sub?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, max > 0 ? value / max : 0);
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#ffe0ef" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`}
          style={{ transition: "stroke-dasharray 0.9s cubic-bezier(0.22,1,0.36,1)", filter: `drop-shadow(0 0 8px ${hexA(color, 0.5)})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-lg font-bold leading-none text-plum-900">{label}</span>
        {sub && <span className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-plum-400">{sub}</span>}
      </div>
    </div>
  );
}

export function Meter({ value, max, color, labelRight }: { value: number; max: number; color: string; labelRight?: string }) {
  const frac = Math.min(1, max > 0 ? value / max : 0);
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-candy-100">
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
        style={{ width: `${frac * 100}%`, background: `linear-gradient(90deg, ${hexA(color, 0.55)}, ${color})`, boxShadow: `0 0 12px ${hexA(color, 0.45)}` }}
      />
      {labelRight && <span className="sr-only">{labelRight}</span>}
    </div>
  );
}

// Resource guardrails: per-server CPU/RAM thresholds evaluated against
// the live 2-second sample ring. A guardrail only fires when EVERY
// sample in the sustain window exceeds the threshold AND the window has
// enough coverage — a short spike (world save, chunk generation) can
// never trigger it. Off by default; the optional restart action is
// opt-in per server.

import fsp from "node:fs/promises";
import path from "node:path";
import { appDataDir } from "./storage";

export type GuardrailAction = "notify" | "restart";

export type GuardrailConfig = {
  enabled: boolean;
  cpuPct: number | null;
  ramMb: number | null;
  sustainMin: number;
  action: GuardrailAction;
};

export const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = {
  enabled: false,
  cpuPct: null,
  ramMb: null,
  sustainMin: 5,
  action: "notify",
};

// The live metrics ring holds 240 × 2s = 8 minutes, so the sustain
// window is capped where the evidence ends.
export const MAX_SUSTAIN_MIN = 8;
export const GUARDRAIL_COOLDOWN_MS = 15 * 60 * 1000;
// At least 80% of the expected samples must exist in the window:
// a server that just started cannot alert on an incomplete picture.
export const MIN_WINDOW_COVERAGE = 0.8;

function clampOrNull(value: unknown, min: number, max: number): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.min(max, Math.max(min, Math.round(num)));
}

export function normalizeGuardrailConfig(raw: unknown): GuardrailConfig {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<GuardrailConfig>;
  return {
    enabled: input.enabled === true,
    cpuPct: clampOrNull(input.cpuPct, 10, 100),
    ramMb: clampOrNull(input.ramMb, 256, 262144),
    sustainMin: clampOrNull(input.sustainMin, 1, MAX_SUSTAIN_MIN) ?? DEFAULT_GUARDRAIL_CONFIG.sustainMin,
    action: input.action === "restart" ? "restart" : "notify",
  };
}

export type GuardrailBreach = { metric: "cpu" | "ram"; value: number; threshold: number; sustainMin: number };

type Sample = { t: number; cpu: number; ram: number };

export function evaluateGuardrail(samples: Sample[], config: GuardrailConfig, now = Date.now()): GuardrailBreach | null {
  if (!config.enabled || (!config.cpuPct && !config.ramMb)) return null;
  const windowMs = config.sustainMin * 60_000;
  const windowSamples = samples.filter((sample) => sample.t >= now - windowMs);
  const expected = Math.floor(windowMs / 2000);
  if (expected === 0 || windowSamples.length < expected * MIN_WINDOW_COVERAGE) return null;
  if (config.cpuPct && windowSamples.every((sample) => sample.cpu > config.cpuPct!)) {
    const peak = Math.max(...windowSamples.map((sample) => sample.cpu));
    return { metric: "cpu", value: peak, threshold: config.cpuPct, sustainMin: config.sustainMin };
  }
  if (config.ramMb && windowSamples.every((sample) => sample.ram > config.ramMb!)) {
    const peak = Math.max(...windowSamples.map((sample) => sample.ram));
    return { metric: "ram", value: peak, threshold: config.ramMb, sustainMin: config.sustainMin };
  }
  return null;
}

// Alert state machine with hysteresis: fire once when a breach begins,
// re-fire only after the cooldown if it persists, reset when it clears.
export type GuardrailState = { active: boolean; lastFiredAt: number };

export function nextGuardrailState(prev: GuardrailState | undefined, breached: boolean, now = Date.now()): GuardrailState & { fire: boolean } {
  const state = prev ?? { active: false, lastFiredAt: 0 };
  if (!breached) return { active: false, lastFiredAt: state.lastFiredAt, fire: false };
  const fire = !state.active || now - state.lastFiredAt >= GUARDRAIL_COOLDOWN_MS;
  return { active: true, lastFiredAt: fire ? now : state.lastFiredAt, fire };
}

// ---- persistence ---------------------------------------------------------

export function guardrailsFile(base?: string): string {
  return path.join(base ?? appDataDir(), "guardrails.json");
}

export async function loadGuardrails(base?: string): Promise<Record<string, GuardrailConfig>> {
  try {
    const raw = JSON.parse(await fsp.readFile(guardrailsFile(base), "utf8")) as Record<string, unknown>;
    if (typeof raw !== "object" || raw === null) return {};
    return Object.fromEntries(Object.entries(raw).map(([id, value]) => [id, normalizeGuardrailConfig(value)]));
  } catch {
    return {};
  }
}

export async function saveGuardrails(all: Record<string, GuardrailConfig>, base?: string): Promise<void> {
  const file = guardrailsFile(base);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(all, null, 2), "utf8");
  cached = null;
}

// Short-lived cache so the 2-second sampler never hammers the disk.
let cached: { at: number; data: Record<string, GuardrailConfig> } | null = null;

export async function loadGuardrailsCached(base?: string): Promise<Record<string, GuardrailConfig>> {
  if (cached && Date.now() - cached.at < 15_000) return cached.data;
  const data = await loadGuardrails(base);
  cached = { at: Date.now(), data };
  return data;
}

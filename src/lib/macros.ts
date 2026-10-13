// Command macros: named sequences of console commands with optional
// pauses, runnable with one click from the console or on a schedule.
// Pure normalization/confirmation logic lives here so it is unit-
// testable; persistence is appdata/macros.json keyed by server id.

import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { appDataDir } from "./storage";

export type MacroStep = { command: string; delaySec: number };
export type Macro = { id: string; name: string; steps: MacroStep[] };

export const MAX_MACROS_PER_SERVER = 20;
export const MAX_MACRO_STEPS = 12;
export const MAX_STEP_DELAY_SEC = 120;

// Normalizes user input into a valid macro, or null when nothing
// usable remains (no name, or no non-empty commands).
export function normalizeMacro(raw: unknown, existingId?: string): Macro | null {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as { name?: unknown; steps?: unknown };
  const name = String(input.name ?? "").trim().slice(0, 60);
  if (!name) return null;
  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  const steps: MacroStep[] = [];
  for (const step of rawSteps.slice(0, MAX_MACRO_STEPS)) {
    const item = (typeof step === "object" && step !== null ? step : {}) as { command?: unknown; delaySec?: unknown };
    const command = String(item.command ?? "").trim().slice(0, 200);
    if (!command) continue;
    const delay = Number(item.delaySec);
    steps.push({ command, delaySec: Number.isFinite(delay) ? Math.min(MAX_STEP_DELAY_SEC, Math.max(0, Math.round(delay))) : 0 });
  }
  if (steps.length === 0) return null;
  return { id: existingId ?? randomUUID(), name, steps };
}

// The exact-confirmation string for scheduling a macro: every command,
// one per line — the same "you confirm precisely what will run"
// contract the command/broadcast task types use.
export function macroConfirmation(macro: Pick<Macro, "steps">): string {
  return macro.steps.map((step) => step.command).join("\n");
}

export function macroSummary(macro: Macro): string {
  const totalDelay = macro.steps.reduce((sum, step) => sum + step.delaySec, 0);
  return `${macro.steps.length} step${macro.steps.length === 1 ? "" : "s"}${totalDelay ? ` · ${totalDelay}s of pauses` : ""}`;
}

// ---- persistence ---------------------------------------------------------

export function macrosFile(base?: string): string {
  return path.join(base ?? appDataDir(), "macros.json");
}

export async function loadMacros(base?: string): Promise<Record<string, Macro[]>> {
  try {
    const raw = JSON.parse(await fsp.readFile(macrosFile(base), "utf8")) as Record<string, unknown>;
    if (typeof raw !== "object" || raw === null) return {};
    const out: Record<string, Macro[]> = {};
    for (const [serverId, list] of Object.entries(raw)) {
      if (!Array.isArray(list)) continue;
      const macros: Macro[] = [];
      for (const item of list.slice(0, MAX_MACROS_PER_SERVER)) {
        const id = typeof (item as { id?: unknown })?.id === "string" ? (item as { id: string }).id : undefined;
        const macro = normalizeMacro(item, id);
        if (macro) macros.push(macro);
      }
      out[serverId] = macros;
    }
    return out;
  } catch {
    return {};
  }
}

export async function saveMacros(all: Record<string, Macro[]>, base?: string): Promise<void> {
  const file = macrosFile(base);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(all, null, 2), "utf8");
}

export async function macrosForServer(serverId: number, base?: string): Promise<Macro[]> {
  return (await loadMacros(base))[String(serverId)] ?? [];
}

export async function findMacro(serverId: number, macroId: string, base?: string): Promise<Macro | null> {
  return (await macrosForServer(serverId, base)).find((macro) => macro.id === macroId) ?? null;
}

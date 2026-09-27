"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Boxes, Check, Cpu, Globe, HardDrive, KeyRound, Loader2, MemoryStick, ShieldCheck, Sparkles, Terminal, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { GAMES, type GameDef } from "@/lib/games";
import { cn, hexA } from "@/lib/format";
import { Btn, Field, Toggle, inputCls } from "./ui";

const ease = [0.22, 1, 0.36, 1] as const;

const SUGGESTIONS: Record<string, string> = {
  minecraft: "Skyfall SMP",
  "minecraft-modded": "Project Redux",
  "minecraft-bedrock": "Crossroads Realms",
  valheim: "Emberhold",
  ark: "The Ark Collective",
  dragonwilds: "Ashenfall Company",
  hytale: "Orbis Explorers",
  terraria: "Deep Delve",
  rust: "Wipe FM",
  custom: "My Custom Server",
};

export function NewServerWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [game, setGame] = useState<GameDef | null>(null);
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [loader, setLoader] = useState("vanilla");
  const [port, setPort] = useState(0);
  const [memory, setMemory] = useState(4096);
  const [slots, setSlots] = useState(20);
  const [world, setWorld] = useState("world");
  const [seed, setSeed] = useState("");
  const [difficulty, setDifficulty] = useState("normal");
  const [motd, setMotd] = useState("");
  const [pvp, setPvp] = useState(true);
  const [serverPassword, setServerPassword] = useState("");
  const [eulaAccepted, setEulaAccepted] = useState(false);
  const [launchCommand, setLaunchCommand] = useState("");
  const [launchArgs, setLaunchArgs] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function chooseGame(g: GameDef) {
    setGame(g);
    setName(SUGGESTIONS[g.id] ?? "My Server");
    setVersion(g.versions[0]);
    setLoader(g.loaders?.[0]?.id ?? "vanilla");
    setPort(g.defaultPort);
    setMemory(g.defaultMemory);
    setSlots(g.defaultMaxPlayers);
    setWorld(g.id === "ark" ? "TheIsland" : g.id === "valheim" ? "Midgard" : "world");
    setMotd(`A ${g.short} server by Server Hub`);
    setServerPassword("");
    setEulaAccepted(false);
    setLaunchCommand("");
    setLaunchArgs("");
    setWorkingDirectory("");
    setError(null);
  }

  const ramGb = useMemo(() => memory / 1024, [memory]);
  const isMinecraft = game?.installer === "mojang" || game?.installer === "fabric";
  const canNext = step === 0
    ? !!game
    : step === 1
      ? Boolean(
          name.trim().length > 0 &&
          port >= 1024 &&
          (!isMinecraft || eulaAccepted) &&
          (!game?.requiresPassword || serverPassword.length >= 5) &&
          (game?.installer !== "manual" || launchCommand.trim())
        )
      : true;

  async function deploy() {
    if (!game || creating) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId: game.id,
          name: name.trim(),
          version,
          loader: game.loaders ? loader : "vanilla",
          port,
          memoryMb: memory,
          maxPlayers: slots,
          motd,
          worldName: world,
          seed,
          difficulty,
          pvp,
          serverPassword,
          eulaAccepted,
          launchCommand,
          launchArgs,
          workingDirectory,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ?? "Failed to deploy");
        setCreating(false);
        return;
      }
      router.push(`/servers/${j.server.id}?fresh=1`);
    } catch (e) {
      setError(String(e));
      setCreating(false);
    }
  }

  const accent = game?.accent ?? "#5be35b";

  return (
    <div className="mx-auto max-w-5xl">
      {/* progress header */}
      <div className="mb-8 flex items-center gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-plum-900">Deploy a server</h1>
          <p className="mt-1 text-[13.5px] text-plum-500">Install real server files locally, then manage the process from one place.</p>
        </div>
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          {["Game", "Configure", "Review"].map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-bold transition-all duration-500",
                  step > i
                    ? "border-transparent text-white"
                    : step === i
                      ? "border-transparent text-white"
                      : "border-candy-300 text-plum-500"
                )}
                style={step >= i ? { background: accent, boxShadow: `0 0 16px ${hexA(accent, 0.45)}` } : undefined}
              >
                {step > i ? <Check size={13} /> : i + 1}
              </span>
              <span className={cn("text-[12px] font-medium", step >= i ? "text-plum-800" : "text-plum-400")}>{label}</span>
              {i < 2 && <span className="mx-1 h-px w-8 bg-candy-100" />}
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* ---------------- STEP 0: game ---------------- */}
        {step === 0 && (
          <motion.section key="s0" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }} transition={{ duration: 0.45, ease }}>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {GAMES.map((g, i) => {
                const selected = game?.id === g.id;
                return (
                  <motion.button
                    key={g.id}
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, delay: i * 0.05, ease }}
                    onClick={() => chooseGame(g)}
                    className="panel panel-hover group relative overflow-hidden text-left"
                    style={selected ? { borderColor: hexA(g.accent, 0.6), boxShadow: `0 0 0 1px ${hexA(g.accent, 0.6)}, 0 18px 50px -20px ${hexA(g.accent, 0.35)}` } : undefined}
                  >
                    <div className="relative h-28 overflow-hidden">
                      {g.art ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={g.art} alt={g.name} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center" style={{ background: `linear-gradient(130deg, ${hexA(g.accent, 0.18)}, #fff0f8)` }}>
                          <Boxes size={34} style={{ color: hexA(g.accent, 0.6) }} />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent" />
                      {selected && (
                        <span className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full text-white" style={{ background: g.accent }}>
                          <Check size={13} strokeWidth={3} />
                        </span>
                      )}
                    </div>
                    <div className="p-4">
                      <p className="font-display text-[15px] font-bold tracking-tight text-plum-900">{g.name}</p>
                      <p className="mt-1 line-clamp-2 min-h-[32px] text-[12px] leading-snug text-plum-500">{g.tagline}</p>
                      <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-medium text-plum-500">
                        <span className="rounded-md bg-candy-50 px-1.5 py-0.5 font-mono">:{g.defaultPort}</span>
                        <span className="rounded-md bg-candy-50 px-1.5 py-0.5">{Math.round(g.defaultMemory / 1024)}G rec.</span>
                        {g.supportsMods && <span className="rounded-md px-1.5 py-0.5" style={{ background: hexA(g.accent, 0.12), color: g.accent }}>{g.modSource ?? "mods"}</span>}
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </motion.section>
        )}

        {/* ---------------- STEP 1: configure ---------------- */}
        {step === 1 && game && (
          <motion.section key="s1" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }} transition={{ duration: 0.45, ease }} className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="panel space-y-5 p-6 lg:col-span-2">
              <Field label="Server name" hint="shown in the server list">
                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={SUGGESTIONS[game.id]} />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label={game.loaders ? "Game version" : "Version"}>
                  <select className={inputCls} value={version} onChange={(e) => setVersion(e.target.value)}>
                    {game.versions.map((v) => (
                      <option key={v} value={v} className="bg-white">{v}</option>
                    ))}
                  </select>
                </Field>
                {game.loaders ? (
                  <Field label="Mod loader">
                    <select className={inputCls} value={loader} onChange={(e) => setLoader(e.target.value)}>
                      {game.loaders.map((l) => (
                        <option key={l.id} value={l.id} className="bg-white">{l.label}</option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <Field label="Difficulty" hint={game.difficulty ? undefined : "n/a for this game"}>
                    <select className={inputCls} value={difficulty} onChange={(e) => setDifficulty(e.target.value)} disabled={!game.difficulty}>
                      {["peaceful", "easy", "normal", "hard"].map((d) => (
                        <option key={d} value={d} className="bg-white capitalize">{d}</option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>

              <Field label={`Memory allocation — ${ramGb.toFixed(ramGb >= 10 ? 0 : 1)} GB`} hint={`${game.minMemory / 1024}G min · ${game.maxMemory / 1024}G max`}>
                <input
                  type="range"
                  min={game.minMemory}
                  max={game.maxMemory}
                  step={1024}
                  value={memory}
                  onChange={(e) => setMemory(Number(e.target.value))}
                  className="w-full"
                  style={{ ["--accent" as never]: accent, ["--fill" as never]: `${((memory - game.minMemory) / (game.maxMemory - game.minMemory)) * 100}%` }}
                />
              </Field>

              <Field label={`Player slots — ${slots}`} hint={`up to ${game.maxPlayersCap}`}>
                <input
                  type="range"
                  min={1}
                  max={game.maxPlayersCap}
                  step={1}
                  value={slots}
                  onChange={(e) => setSlots(Number(e.target.value))}
                  className="w-full"
                  style={{ ["--accent" as never]: accent, ["--fill" as never]: `${(slots / game.maxPlayersCap) * 100}%` }}
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label={`Port`} hint={`${game.protocol} · default ${game.defaultPort}`}>
                  <input className={cn(inputCls, "font-mono")} type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} min={1024} max={65535} />
                </Field>
                <Field label={game.worldLabel}>
                  <input className={inputCls} value={world} onChange={(e) => setWorld(e.target.value)} maxLength={40} />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="World seed" hint="optional">
                  <input className={cn(inputCls, "font-mono")} value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="leave blank for random" />
                </Field>
                <Field label="MOTD / description">
                  <input className={inputCls} value={motd} onChange={(e) => setMotd(e.target.value)} maxLength={80} />
                </Field>
              </div>

              {game.requiresPassword && (
                <Field label="Server password" hint="minimum 5 characters · stored locally">
                  <div className="relative">
                    <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-plum-400" />
                    <input className={cn(inputCls, "pl-9")} type="password" value={serverPassword} onChange={(e) => setServerPassword(e.target.value)} minLength={5} autoComplete="new-password" />
                  </div>
                </Field>
              )}

              {game.installer === "manual" && (
                <div className="space-y-4 rounded-xl border border-candy-200 bg-candy-50 p-4">
                  <p className="flex items-center gap-2 text-[13px] font-semibold text-plum-800"><Terminal size={14} style={{ color: accent }} /> Existing server process</p>
                  <Field label="Launch executable or script" hint="required · absolute or relative path">
                    <input className={cn(inputCls, "font-mono")} value={launchCommand} onChange={(e) => setLaunchCommand(e.target.value)} placeholder="server.exe, ./start.sh, or an absolute path" />
                  </Field>
                  <Field label="Arguments" hint="optional · quotes supported">
                    <input className={cn(inputCls, "font-mono")} value={launchArgs} onChange={(e) => setLaunchArgs(e.target.value)} placeholder={`--port ${port} --world "${world}"`} />
                  </Field>
                  <Field label="Working directory" hint="optional existing absolute folder">
                    <input className={cn(inputCls, "font-mono")} value={workingDirectory} onChange={(e) => setWorkingDirectory(e.target.value)} placeholder="C:\\Servers\\MyServer or /home/me/servers/my-server" />
                  </Field>
                  <p className="text-[11.5px] leading-relaxed text-plum-500">If the folder is blank, Server Hub creates managed storage. Existing folders are never deleted when you remove the server entry.</p>
                </div>
              )}

              {isMinecraft && (
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={eulaAccepted} onChange={(e) => setEulaAccepted(e.target.checked)} />
                  <span>
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-plum-800"><ShieldCheck size={13} className="text-emerald-600" /> I accept the Minecraft EULA</span>
                    <span className="mt-0.5 block text-[11.5px] text-plum-500">Required to write eula=true and run Mojang&apos;s server. Review minecraft.net/eula.</span>
                  </span>
                </label>
              )}

              <div className="flex items-center justify-between rounded-xl border border-candy-200 bg-candy-50 px-4 py-3">
                <div>
                  <p className="text-[13.5px] font-medium text-plum-800">PvP enabled</p>
                  <p className="text-[11.5px] text-plum-500">Players can damage each other</p>
                </div>
                <Toggle checked={pvp} onChange={setPvp} accent={accent} />
              </div>
            </div>

            {/* config summary */}
            <div className="panel h-fit space-y-4 overflow-hidden lg:sticky lg:top-6">
              <div className="relative h-32">
                {game.art ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={game.art} alt={game.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full" style={{ background: `linear-gradient(130deg, ${hexA(accent, 0.25)}, #fff0f8)` }} />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-white to-transparent" />
                <div className="absolute bottom-3 left-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: accent }}>{game.short}</p>
                  <p className="font-display text-lg font-bold text-plum-900">{name || "Untitled server"}</p>
                </div>
              </div>
              <div className="space-y-2.5 px-5 pb-5 pt-1 text-[12.5px]">
                <SummaryRow icon={<Sparkles size={12} />} k="Version" v={`${version}${game.loaders ? ` · ${loader}` : ""}`} />
                <SummaryRow icon={<MemoryStick size={12} />} k="Memory" v={`${ramGb.toFixed(1)} GB`} />
                <SummaryRow icon={<Users size={12} />} k="Slots" v={String(slots)} />
                <SummaryRow icon={<Globe size={12} />} k="Port" v={`${port}/${game.protocol.toLowerCase()}`} mono />
                <SummaryRow icon={<HardDrive size={12} />} k="Install size" v={`${(game.installSizeMb / 1000).toFixed(1)} GB`} />
                <SummaryRow icon={<Cpu size={12} />} k="Installer" v={game.installerLabel} mono />
              </div>
            </div>
          </motion.section>
        )}

        {/* ---------------- STEP 2: review ---------------- */}
        {step === 2 && game && (
          <motion.section key="s2" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }} transition={{ duration: 0.45, ease }}>
            <div className="panel overflow-hidden">
              <div className="relative h-40 sm:h-48">
                {game.art ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={game.art} alt={game.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full" style={{ background: `linear-gradient(130deg, ${hexA(accent, 0.25)}, #fff0f8)` }} />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-white via-white/60 to-transparent" />
                <div className="absolute bottom-4 left-6">
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em]" style={{ color: accent }}>{game.name}</p>
                  <p className="font-display text-3xl font-bold tracking-tight text-plum-900">{name}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-px bg-candy-100 sm:grid-cols-4">
                {[
                  ["Version", version],
                  game.loaders ? ["Loader", loader] : ["Difficulty", difficulty],
                  ["Memory", `${ramGb.toFixed(1)} GB`],
                  ["Slots", String(slots)],
                  ["Port", String(port)],
                  ["World", world || "world"],
                  ["Seed", seed || "random"],
                  ["PvP", pvp ? "enabled" : "disabled"],
                ].map(([k, v]) => (
                  <div key={k} className="bg-white px-4 py-3.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-plum-400">{k}</p>
                    <p className="mt-1 truncate font-mono text-[13px] text-plum-800">{v}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-candy-200/70 p-5">
                <p className="mr-auto max-w-md text-[12px] leading-relaxed text-plum-500">
                  Server Hub will use <span className="font-mono text-plum-700">{game.installerLabel}</span>, store files on this PC and stream genuine installer and process output to the console. Downloads may take several minutes for large games.
                </p>
                {error && <p className="text-[12.5px] font-medium text-red-500">{error}</p>}
                <Btn variant="primary" size="lg" accent={accent} onClick={deploy} loading={creating}>
                  {creating ? "Provisioning…" : "Deploy server"}
                </Btn>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* nav footer */}
      <div className="mt-7 flex items-center justify-between">
        <Btn variant="ghost" onClick={() => (step === 0 ? router.push("/") : setStep(step - 1))} disabled={creating}>
          <ArrowLeft size={15} /> {step === 0 ? "Cancel" : "Back"}
        </Btn>
        {step < 2 && (
          <Btn variant="primary" accent={accent} onClick={() => canNext && setStep(step + 1)} disabled={!canNext}>
            Continue <ArrowRight size={15} />
          </Btn>
        )}
        {step === 2 && creating && (
          <span className="flex items-center gap-2 text-[12px] text-plum-500">
            <Loader2 size={13} className="animate-spin" /> Building your world…
          </span>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ icon, k, v, mono }: { icon: React.ReactNode; k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-plum-400">{icon}</span>
      <span className="text-plum-500">{k}</span>
      <span className={cn("ml-auto max-w-[55%] truncate text-right text-plum-800", mono && "font-mono text-[11.5px]")}>{v}</span>
    </div>
  );
}

// Connection doctor: explains WHY "LAN works but internet doesn't" for a
// game server. The classic failure chain is local server → Windows
// Firewall → router port forward → ISP (CGNAT). This module is the pure
// core — address classification and verdict building — so every rule is
// unit-testable; the API route supplies the measured facts (UDP/TCP port
// probe, detected public IP). Client-portable: no node: imports.

export type AddressClass = "public" | "private" | "cgnat" | "loopback" | "invalid";

/** Classify an IPv4 address the way a router would. */
export function classifyAddress(ip: string): AddressClass {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!match) return "invalid";
  const [a, b, c, d] = match.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return "invalid";
  if (a === 127) return "loopback";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 169 && b === 254) return "private";
  // RFC 6598 shared address space — the signature of carrier-grade NAT.
  if (a === 100 && b >= 64 && b <= 127) return "cgnat";
  return "public";
}

export type DoctorFacts = {
  serverStatus: string;
  /** True when something is bound on bindAddress:port (the game, hopefully). */
  portBound: boolean | null;
  bindAddress: string;
  port: number;
  protocol: string;
  configuredPublic: string;
  /** Public IP detected from this machine, or null when detection failed. */
  detectedPublic: string | null;
};

export type Verdict = { id: string; level: "ok" | "warn" | "fail"; title: string; advice: string };

/** Ordered checklist — first fail is almost always the actual problem. */
export function buildVerdicts(facts: DoctorFacts): Verdict[] {
  const verdicts: Verdict[] = [];
  const proto = facts.protocol.toUpperCase();
  const forward = `${proto} ${facts.port} → ${facts.bindAddress}:${facts.port}`;

  // 1. Is the server even running and listening?
  if (facts.serverStatus !== "online") {
    verdicts.push({ id: "running", level: "fail", title: `Server is ${facts.serverStatus}, not online`, advice: "Start the server and wait for the Ready health state before testing connections." });
  } else if (facts.portBound === false) {
    verdicts.push({ id: "listening", level: "fail", title: `Nothing is listening on ${facts.bindAddress}:${facts.port}`, advice: "The process is up but the port is free — check the server's own port setting matches what Server Hub expects." });
  } else {
    verdicts.push({ id: "listening", level: "ok", title: `Server is online${facts.portBound ? ` and ${facts.bindAddress}:${facts.port} is bound` : ""}`, advice: "LAN players can connect directly — the local half of the chain is healthy." });
  }

  // 2. Does the configured public address make sense?
  const configuredClass = classifyAddress(facts.configuredPublic);
  if (configuredClass === "invalid") {
    verdicts.push({ id: "configured", level: "fail", title: `"${facts.configuredPublic}" is not a valid IPv4 address`, advice: "Fix the Public address field in Settings — internet players type exactly this." });
  } else if (configuredClass !== "public") {
    verdicts.push({ id: "configured", level: "fail", title: `The configured public address is a ${configuredClass} address`, advice: "Internet players can never reach a private/loopback address. Put your real public IP (or DNS name's IP) in Settings." });
  } else {
    verdicts.push({ id: "configured", level: "ok", title: `Configured public address ${facts.configuredPublic} is a routable public IP`, advice: "" });
  }

  // 3. Compare with the public IP this machine actually goes out with.
  if (facts.detectedPublic === null) {
    verdicts.push({ id: "detected", level: "warn", title: "Could not detect this machine's public IP", advice: "No internet route from the panel right now — the comparison with the configured address was skipped." });
  } else {
    const detectedClass = classifyAddress(facts.detectedPublic);
    if (detectedClass === "cgnat") {
      verdicts.push({ id: "detected", level: "fail", title: `Your connection goes out through carrier-grade NAT (${facts.detectedPublic})`, advice: "Port forwarding cannot work behind CGNAT. Ask your ISP for a real public IP, or tunnel the server (VPS reverse tunnel, Tailscale Funnel, playit.gg)." });
    } else if (facts.configuredPublic !== facts.detectedPublic && configuredClass === "public") {
      verdicts.push({ id: "detected", level: "fail", title: `This machine's public IP is ${facts.detectedPublic}, not ${facts.configuredPublic}`, advice: "Players are aiming at the wrong address. Update the Public address in Settings — home IPs change unless your ISP assigns a static one." });
    } else {
      verdicts.push({ id: "detected", level: "ok", title: `Detected public IP matches the configured address (${facts.detectedPublic})`, advice: "" });
    }
  }

  // 4. The parts no panel can see from inside: firewall + router + test method.
  verdicts.push({ id: "firewall", level: "warn", title: `Allow inbound ${proto} ${facts.port} in Windows Firewall`, advice: `PowerShell (admin): New-NetFirewallRule -DisplayName "Game server ${facts.port}" -Direction Inbound -LocalPort ${facts.port} -Protocol ${proto} -Action Allow` });
  verdicts.push({ id: "forward", level: "warn", title: `Forward ${forward} on your router`, advice: `The rule must be ${proto} (TCP-only rules silently fail for ${proto} games) and must point at ${facts.bindAddress}. Give this machine a DHCP reservation so the rule never goes stale.` });
  verdicts.push({ id: "hairpin", level: "warn", title: "Test from OUTSIDE your network", advice: "Most home routers cannot loop a public IP back inside (NAT hairpin). From inside the LAN use the LAN address; have a friend — or your phone on mobile data — test the public one." });

  return verdicts;
}

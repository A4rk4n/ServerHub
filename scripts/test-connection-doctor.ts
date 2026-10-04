// Bugfix companion (v2.64.0) — connection doctor for "LAN works, internet
// doesn't". Address classification (incl. RFC 6598 CGNAT space), the
// ordered verdict chain, the real UDP bind probe, and pinned wiring for
// the route and the Player Connection Center section.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import dgram from "node:dgram";
import test from "node:test";
import { buildVerdicts, classifyAddress, type DoctorFacts } from "../src/lib/connection-doctor";
import { probePortBound } from "../src/lib/connection-probe";

const baseFacts: DoctorFacts = {
  serverStatus: "online",
  portBound: true,
  bindAddress: "192.168.1.210",
  port: 7777,
  protocol: "UDP",
  configuredPublic: "185.83.148.20",
  detectedPublic: "185.83.148.20",
};

test("classifyAddress knows public, private, CGNAT, loopback, and junk", () => {
  assert.equal(classifyAddress("185.83.148.20"), "public");
  assert.equal(classifyAddress("192.168.1.210"), "private");
  assert.equal(classifyAddress("10.0.0.5"), "private");
  assert.equal(classifyAddress("172.16.0.1"), "private");
  assert.equal(classifyAddress("172.32.0.1"), "public", "172.32 is outside the private /12");
  assert.equal(classifyAddress("169.254.1.1"), "private");
  assert.equal(classifyAddress("127.0.0.1"), "loopback");
  assert.equal(classifyAddress("100.64.0.1"), "cgnat", "RFC 6598 shared space = carrier-grade NAT");
  assert.equal(classifyAddress("100.127.255.255"), "cgnat");
  assert.equal(classifyAddress("100.128.0.1"), "public", "just past the CGNAT /10");
  assert.equal(classifyAddress("300.1.1.1"), "invalid");
  assert.equal(classifyAddress("not-an-ip"), "invalid");
});

test("healthy facts produce ok checks plus the three irreducible manual steps", () => {
  const verdicts = buildVerdicts(baseFacts);
  const byId = new Map(verdicts.map((v) => [v.id, v]));
  assert.equal(byId.get("listening")!.level, "ok");
  assert.equal(byId.get("configured")!.level, "ok");
  assert.equal(byId.get("detected")!.level, "ok");
  // Firewall, router forward, and outside-test guidance can never be verified from inside.
  assert.equal(byId.get("firewall")!.level, "warn");
  assert.ok(byId.get("firewall")!.advice.includes("New-NetFirewallRule"), "copy-pasteable PowerShell");
  assert.equal(byId.get("forward")!.level, "warn");
  assert.ok(byId.get("forward")!.advice.includes("TCP-only rules silently fail"), "the classic UDP mistake is called out");
  assert.ok(byId.get("forward")!.title.includes("UDP 7777 → 192.168.1.210:7777"));
  assert.equal(byId.get("hairpin")!.level, "warn");
  assert.ok(byId.get("hairpin")!.advice.includes("NAT hairpin"));
});

test("each broken link in the chain fails with targeted advice", () => {
  // Server not running.
  const offline = buildVerdicts({ ...baseFacts, serverStatus: "offline" });
  assert.equal(offline.find((v) => v.id === "running")!.level, "fail");
  // Online but the port is free — the game listens elsewhere.
  const unbound = buildVerdicts({ ...baseFacts, portBound: false }).find((v) => v.id === "listening")!;
  assert.equal(unbound.level, "fail");
  assert.ok(unbound.title.includes("Nothing is listening"));
  // Private address configured as "public".
  const privatePublic = buildVerdicts({ ...baseFacts, configuredPublic: "192.168.1.210" }).find((v) => v.id === "configured")!;
  assert.equal(privatePublic.level, "fail");
  // The machine egresses with a different IP than configured.
  const wrongIp = buildVerdicts({ ...baseFacts, detectedPublic: "81.2.3.4" }).find((v) => v.id === "detected")!;
  assert.equal(wrongIp.level, "fail");
  assert.ok(wrongIp.title.includes("81.2.3.4, not 185.83.148.20"));
  // CGNAT: forwarding can never work.
  const cgnat = buildVerdicts({ ...baseFacts, detectedPublic: "100.72.11.9" }).find((v) => v.id === "detected")!;
  assert.equal(cgnat.level, "fail");
  assert.ok(cgnat.advice.includes("CGNAT"));
  // Detection unavailable degrades to a warning, never a false fail.
  const unknown = buildVerdicts({ ...baseFacts, detectedPublic: null }).find((v) => v.id === "detected")!;
  assert.equal(unknown.level, "warn");
});

test("probePortBound tells a bound UDP port from a free one", async () => {
  const free = await probePortBound("UDP", "127.0.0.1", 46551);
  assert.equal(free, false, "nobody on the port → we can bind it → not bound");
  const socket = dgram.createSocket("udp4");
  await new Promise<void>((resolve) => socket.bind(46552, "127.0.0.1", resolve));
  try {
    assert.equal(await probePortBound("UDP", "127.0.0.1", 46552), true, "a held port reports bound");
  } finally {
    socket.close();
  }
});

test("wiring is pinned: route probes both facts, UI section exists", () => {
  const route = readFileSync("src/app/api/servers/[id]/connection-check/route.ts", "utf8");
  assert.ok(route.includes("probePortBound(game.protocol, server.bindAddress, server.port)"));
  assert.ok(route.includes("detectPublicIp()"));
  assert.ok(route.includes("verdicts: buildVerdicts(facts)"));
  const ui = readFileSync("src/components/connection-manager.tsx", "utf8");
  assert.ok(ui.includes("Connection doctor"));
  assert.ok(ui.includes("connection-check"));
  assert.ok(ui.includes("carrier-grade NAT"), "the panel explains what the doctor catches");
  console.log("CONNECTION_DOCTOR_SUITE_OK");
});

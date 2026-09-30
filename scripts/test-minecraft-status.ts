import assert from "node:assert/strict";
import test from "node:test";
import { parseMinecraftStatus } from "../src/lib/query-protocols";

test("parseMinecraftStatus decodes version, motd, players, and latency", () => {
  const status = parseMinecraftStatus({ version: { name: "1.21.8", protocol: 772 }, description: { text: "Ahri SMP" }, players: { online: 3, max: 20, sample: [{ name: "Ahri" }, { name: "Poro" }] } }, 42);
  assert.deepEqual(status, { version: "1.21.8", protocol: 772, motd: "Ahri SMP", players: 3, maxPlayers: 20, samplePlayers: ["Ahri", "Poro"], latencyMs: 42 });
});

test("parseMinecraftStatus accepts a plain-string MOTD", () => {
  assert.equal(parseMinecraftStatus({ description: "Plain MOTD" }).motd, "Plain MOTD");
  console.log("MINECRAFT_STATUS_PARSER_REGRESSION_OK");
});

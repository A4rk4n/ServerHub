import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parseMojangVersions, serverCatalog, validCatalogVersion } from "../src/lib/catalog";

test("parseMojangVersions maps releases and snapshots to channels", () => {
  const parsed = parseMojangVersions({
    versions: [
      { id: "1.22.1", type: "release", releaseTime: "2026-01-01T00:00:00Z" },
      { id: "26w10a", type: "snapshot", releaseTime: "2026-02-01T00:00:00Z" },
      { id: "ignored", type: "old_alpha" },
    ],
  });
  assert.deepEqual(parsed.map((x) => [x.id, x.channel]), [["1.22.1", "stable"], ["26w10a", "preview"]]);
});

test("the server catalog flags automatic providers and validates versions", () => {
  const catalog = serverCatalog();
  assert.ok(catalog.find((x) => x.id === "minecraft")?.automatic);
  assert.ok(catalog.find((x) => x.id === "satisfactory")?.automatic);
  assert.equal(catalog.find((x) => x.id === "satisfactory")?.installerLabel.includes("1690800"), true);
  assert.ok(catalog.find((x) => x.id === "palworld")?.automatic);
  assert.equal(catalog.find((x) => x.id === "palworld")?.installerLabel.includes("2394010"), true);
  assert.equal(catalog.find((x) => x.id === "custom")?.automatic, false);
  assert.equal(validCatalogVersion("minecraft", "1.22.1"), true);
  assert.equal(validCatalogVersion("minecraft", "../../evil"), false);
});

test("the Palworld provider manages settings through PalWorldSettings.ini", () => {
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  // Palworld has no bind-address flag: the port and player cap are the only
  // command-line options, everything else must go through the ini writer.
  const launch = runtime.slice(runtime.indexOf('server.gameId === "palworld"', runtime.indexOf("async function launchSpec")));
  assert.ok(launch.slice(0, 900).includes("`-port=${server.port}`"));
  assert.ok(launch.slice(0, 900).includes("`-players=${server.maxPlayers}`"));
  assert.equal(launch.slice(0, 900).includes("multihome"), false);
  const config = runtime.slice(runtime.indexOf('server.gameId === "palworld"', runtime.indexOf("export async function writeServerConfig")));
  const tuple = config.slice(0, 1600);
  assert.ok(tuple.includes("PalWorldSettings.ini"));
  for (const key of ["ServerName=", "ServerPlayerMaxNum=", "PublicPort=", "ServerPassword=", "AdminPassword=", "RCONEnabled=False"]) {
    assert.ok(tuple.includes(key), key);
  }
  // Double quotes must be stripped so values cannot break the tuple syntax.
  assert.ok(tuple.includes('replace(/[\\r\\n"]/g'));
  assert.ok(runtime.includes('"PalServer.exe"') && runtime.includes('"PalServer.sh"'));
  console.log("PALWORLD_PROVIDER_WIRING_OK");
});

test("every automatic provider downloads over HTTPS", () => {
  const catalog = serverCatalog();
  for (const item of catalog.filter((x) => x.automatic)) {
    assert.match(item.sourceUrl, /^https:\/\//);
  }
  console.log("IN_APP_SERVER_CATALOG_OK", { games: catalog.length });
});

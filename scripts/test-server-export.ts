import assert from "node:assert/strict";
import test from "node:test";
import {
  EXPORT_FILE_PATTERN,
  EXPORT_MANIFEST_NAME,
  EXPORT_MANIFEST_VERSION,
  aggregateChecksum,
  buildExportManifest,
  exportFileName,
  shouldExcludeFromExport,
  verifyExportManifest,
} from "../src/lib/server-export";

const sampleServer = {
  name: "Lobby One",
  gameId: "minecraft",
  version: "1.21.1",
  loader: "vanilla",
  port: 25565,
  bindAddress: "192.168.1.210",
  memoryMb: 4096,
  maxPlayers: 20,
  motd: "welcome",
  worldName: "world",
  seed: "42",
  difficulty: "normal",
  pvp: true,
  launchCommand: "",
  launchArgs: "",
  autoRestart: true,
  maxCrashRestarts: 3,
  restartWindowSec: 300,
  readinessTimeoutSec: 60,
  // row fields that must never travel:
  serverPassword: "sup3r-s3cret",
  adminPassword: "hunter2",
  ownerId: "7656119",
  status: "online",
  id: 7,
};

test("export: manifest is built by whitelist — secrets can never leak", () => {
  const manifest = buildExportManifest({
    server: sampleServer,
    appVersion: "2.40.0",
    files: { count: 3, totalBytes: 1234, checksum: "a".repeat(64) },
    now: new Date(Date.UTC(2026, 9, 1, 12, 0, 0)),
  });
  assert.equal(manifest.manifestVersion, EXPORT_MANIFEST_VERSION);
  assert.equal(manifest.exportedAt, "2026-10-01T12:00:00.000Z");
  assert.equal(manifest.exportedBy, "Server Hub 2.40.0");
  assert.equal(manifest.server.name, "Lobby One");
  assert.equal(manifest.server.gameId, "minecraft");
  assert.equal(manifest.server.memoryMb, 4096);
  assert.equal(manifest.files.checksum.algorithm, "sha256");
  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /sup3r-s3cret|hunter2|serverPassword|adminPassword|ownerId/);
  assert.ok(!("status" in manifest.server) && !("id" in manifest.server), "row bookkeeping does not travel");
});

test("export: transient files are excluded, real content is not", () => {
  assert.equal(shouldExcludeFromExport(EXPORT_MANIFEST_NAME), true);
  assert.equal(shouldExcludeFromExport("world/session.lock"), true);
  assert.equal(shouldExcludeFromExport("server.properties.serverhub-4242.tmp"), true);
  assert.equal(shouldExcludeFromExport("server.properties"), false);
  assert.equal(shouldExcludeFromExport("server.properties.bak-20261001-090507"), false, "safety copies travel");
  assert.equal(shouldExcludeFromExport("world/level.dat"), false);
  assert.equal(shouldExcludeFromExport("mods\\fabric-api.jar"), false);
});

test("export: aggregate checksum is order-independent and content-sensitive", () => {
  const a = { path: "a.txt", sha256: "1".repeat(64) };
  const b = { path: "dir/b.txt", sha256: "2".repeat(64) };
  const forward = aggregateChecksum([a, b]);
  assert.match(forward, /^[0-9a-f]{64}$/);
  assert.equal(aggregateChecksum([b, a]), forward, "order never matters");
  assert.equal(aggregateChecksum([{ path: "dir\\b.txt", sha256: b.sha256 }, a]), forward, "separators are normalized");
  assert.notEqual(aggregateChecksum([a, { ...b, sha256: "3".repeat(64) }]), forward, "content changes the aggregate");
  assert.notEqual(aggregateChecksum([a]), forward, "missing files change the aggregate");
});

test("export: bundle file names are safe, stamped, and recognizable", () => {
  const now = new Date(2026, 9, 1, 9, 5, 7);
  assert.equal(exportFileName("Lobby One", now), "lobby-one-export-20261001-090507.tar.gz");
  assert.equal(exportFileName("  ~~Überserver!!  ", now), "berserver-export-20261001-090507.tar.gz");
  assert.equal(exportFileName("!!!", now), "server-export-20261001-090507.tar.gz");
  for (const name of ["Lobby One", "x", "A-very_long NAME with töns of junk 12345678901234567890"]) {
    assert.match(exportFileName(name, now), EXPORT_FILE_PATTERN, name);
  }
  assert.doesNotMatch("../../etc/passwd", EXPORT_FILE_PATTERN);
  assert.doesNotMatch("evil-export-20261001-090507.tar.gz.sh", EXPORT_FILE_PATTERN);
});

test("export: manifest verification accepts round-trips and rejects junk", () => {
  const manifest = buildExportManifest({
    server: sampleServer,
    appVersion: "2.40.0",
    files: { count: 2, totalBytes: 10, checksum: "b".repeat(64) },
  });
  const verdict = verifyExportManifest(JSON.parse(JSON.stringify(manifest)));
  assert.equal(verdict.ok, true);
  if (verdict.ok) assert.equal(verdict.manifest.server.gameId, "minecraft");
  assert.equal(verifyExportManifest(null).ok, false);
  assert.equal(verifyExportManifest("string").ok, false);
  assert.equal(verifyExportManifest({ ...manifest, manifestVersion: 99 }).ok, false);
  assert.equal(verifyExportManifest({ ...manifest, server: { ...manifest.server, gameId: "" } }).ok, false);
  assert.equal(verifyExportManifest({ ...manifest, files: { ...manifest.files, checksum: { algorithm: "sha256", value: "short" } } }).ok, false);
  const noServer = { ...manifest } as Record<string, unknown>;
  delete noServer.server;
  assert.equal(verifyExportManifest(noServer).ok, false);
  console.log("SERVER_EXPORT_SUITE_OK");
});

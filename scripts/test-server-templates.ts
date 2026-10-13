import assert from "node:assert/strict";
import test from "node:test";
import { nextFreeServerPort, TEMPLATE_EXCLUDED_FIELDS, templateConfigFromServer } from "../src/lib/server-templates";

const source = { gameId: "minecraft", version: "1.21", loader: "vanilla", memoryMb: 4096, maxPlayers: 20, motd: "hello", difficulty: "normal", pvp: true, bindAddress: "192.168.1.210", publicAddress: "185.83.148.20", readinessTimeoutSec: 60, autoRestart: true, maxCrashRestarts: 3, restartWindowSec: 300, autoBackupBeforeUpdate: true, updateBackupRetention: 5, backupRetentionCount: 10, backupRetentionDays: 30, serverPassword: "secret", adminPassword: "admin", ownerId: "player", worldName: "private-world", seed: "seed", port: 25565, launchCommand: "private.exe", launchArgs: "--token secret", workingDirectory: "C:\\Users\\Ahri\\server" };

test("template configs omit every excluded field", () => {
  const config = templateConfigFromServer(source);
  for (const field of TEMPLATE_EXCLUDED_FIELDS) {
    assert.equal(Object.hasOwn(config, field), false, field);
  }
});

test("serialized template configs leak no secrets or private paths", () => {
  const serialized = JSON.stringify(templateConfigFromServer(source));
  for (const value of ["secret", "admin", "player", "private-world", "C:\\Users\\Ahri"]) {
    assert.equal(serialized.includes(value), false, value);
  }
});

test("nextFreeServerPort climbs past occupied ports and stays in range", () => {
  assert.equal(nextFreeServerPort(25565, []), 25565);
  assert.equal(nextFreeServerPort(25565, [25565, 25566]), 25567);
  assert.equal(nextFreeServerPort(1, []), 1024);
  assert.throws(() => nextFreeServerPort(65535, [65535]));
  console.log("SERVER_TEMPLATE_SECURITY_REGRESSION_OK");
});

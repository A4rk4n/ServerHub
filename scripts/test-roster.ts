import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_OP_LEVEL,
  actionNeedsName,
  isMinecraftJava,
  offlineUuid,
  parseRosterFile,
  readWhitelistEnabled,
  removeOp,
  removeWhitelist,
  rosterCommands,
  setWhitelistEnabled,
  upsertOp,
  upsertWhitelist,
  validMinecraftName,
  type OpsEntry,
  type WhitelistEntry,
} from "../src/lib/roster";

test("roster: offline uuid matches the vanilla derivation", () => {
  // Well-known offline-mode UUIDs (Java UUID.nameUUIDFromBytes("OfflinePlayer:" + name)).
  assert.equal(offlineUuid("Notch"), "b50ad385-829d-3141-a216-7e7d7539ba7f");
  assert.equal(offlineUuid("jeb_"), "a762f560-4fce-3236-812a-b80efff0b62b");
  // Structural invariants: v3 version nibble, IETF variant, deterministic, case-sensitive.
  const uuid = offlineUuid("Steve");
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(offlineUuid("Steve"), uuid);
  assert.notEqual(offlineUuid("steve"), uuid);
});

test("roster: whitelist upsert and remove are case-insensitive and idempotent", () => {
  const start: WhitelistEntry[] = [{ uuid: offlineUuid("Alpha"), name: "Alpha" }];
  const added = upsertWhitelist(start, "Beta", offlineUuid("Beta"));
  assert.equal(added.changed, true);
  assert.deepEqual(added.list.map((e) => e.name), ["Alpha", "Beta"]);
  const duplicate = upsertWhitelist(added.list, "ALPHA", offlineUuid("ALPHA"));
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.list, added.list);
  const removed = removeWhitelist(added.list, "alpha");
  assert.equal(removed.changed, true);
  assert.deepEqual(removed.list.map((e) => e.name), ["Beta"]);
  assert.equal(removeWhitelist(removed.list, "Gamma").changed, false);
  // defensive parsing
  assert.deepEqual(parseRosterFile(null), []);
  assert.deepEqual(parseRosterFile("not json"), []);
  assert.deepEqual(parseRosterFile('{"name":"obj-not-array"}'), []);
  assert.equal(parseRosterFile<WhitelistEntry>('[{"uuid":"u","name":"Ok"},{"bad":true},null]').length, 1);
});

test("roster: ops promote, level update, and demote", () => {
  const promoted = upsertOp([], "Admin", offlineUuid("Admin"));
  assert.equal(promoted.changed, true);
  assert.deepEqual(promoted.list, [{ uuid: offlineUuid("Admin"), name: "Admin", level: DEFAULT_OP_LEVEL, bypassesPlayerLimit: false }]);
  assert.equal(upsertOp(promoted.list, "admin", offlineUuid("admin")).changed, false);
  const releveled = upsertOp(promoted.list, "Admin", offlineUuid("Admin"), 2);
  assert.equal(releveled.changed, true);
  assert.equal(releveled.list[0].level, 2);
  const demoted = removeOp(releveled.list as OpsEntry[], "ADMIN");
  assert.equal(demoted.changed, true);
  assert.deepEqual(demoted.list, []);
});

test("roster: server.properties whitelist toggle preserves the file", () => {
  assert.equal(readWhitelistEnabled(null), null);
  assert.equal(readWhitelistEnabled("motd=hi\n"), null);
  assert.equal(readWhitelistEnabled("white-list=true\n"), true);
  assert.equal(readWhitelistEnabled("white-list=FALSE\n"), false);
  const props = "# Minecraft server properties\nmotd=Hello\nwhite-list=false\npvp=true\n";
  const on = setWhitelistEnabled(props, true);
  assert.equal(on, "# Minecraft server properties\nmotd=Hello\nwhite-list=true\npvp=true\n");
  assert.equal(readWhitelistEnabled(on), true);
  const appended = setWhitelistEnabled("motd=Hello", true);
  assert.equal(appended, "motd=Hello\nwhite-list=true\n");
  assert.equal(setWhitelistEnabled(null, false), "white-list=false\n");
});

test("roster: command mapping, name validation, and game gating", () => {
  assert.deepEqual(rosterCommands("whitelist-add", "Steve"), ["whitelist add Steve"]);
  assert.deepEqual(rosterCommands("whitelist-remove", "Steve"), ["whitelist remove Steve"]);
  assert.deepEqual(rosterCommands("op", "Steve"), ["op Steve"]);
  assert.deepEqual(rosterCommands("deop", "Steve"), ["deop Steve"]);
  assert.deepEqual(rosterCommands("whitelist-on"), ["whitelist on"]);
  assert.deepEqual(rosterCommands("whitelist-off"), ["whitelist off"]);
  assert.equal(actionNeedsName("whitelist-add"), true);
  assert.equal(actionNeedsName("whitelist-on"), false);
  for (const good of ["Steve", "jeb_", "a_1", "X".repeat(16)]) assert.equal(validMinecraftName(good), true, good);
  for (const bad of ["ab", "X".repeat(17), "bad name", "hyphen-ated", "ünïcode", ""]) assert.equal(validMinecraftName(bad), false, bad);
  assert.equal(isMinecraftJava("minecraft"), true);
  assert.equal(isMinecraftJava("minecraft-modded"), true);
  assert.equal(isMinecraftJava("minecraft-bedrock"), false);
  assert.equal(isMinecraftJava("palworld"), false);
  console.log("ROSTER_SUITE_OK");
});

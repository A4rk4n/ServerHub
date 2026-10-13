// Ban-list manager (banlist.ts): vanilla-format dates, defensive file
// parsing, upsert/remove semantics, IP validation, console-command
// mapping, and the route/page wiring pins.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  DEFAULT_BAN_REASON,
  banlistCommand,
  formatBanDate,
  parseBanList,
  parseIpBanList,
  removeBan,
  removeIpBan,
  upsertBan,
  upsertIpBan,
  validBanIp,
} from "../src/lib/banlist";

test("formatBanDate matches vanilla's yyyy-MM-dd HH:mm:ss Z shape in UTC", () => {
  assert.equal(formatBanDate(new Date(Date.UTC(2026, 9, 12, 9, 5, 3))), "2026-10-12 09:05:03 +0000");
  assert.match(formatBanDate(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \+0000$/);
});

test("parsers keep only well-shaped entries and never throw", () => {
  assert.deepEqual(parseBanList(null), []);
  assert.deepEqual(parseBanList("not json"), []);
  assert.deepEqual(parseBanList('{"an":"object"}'), []);
  const mixed = JSON.stringify([
    { uuid: "u", name: "Griefer", created: "x", source: "Server", expires: "forever", reason: "why" },
    { noName: true },
    null,
  ]);
  assert.equal(parseBanList(mixed).length, 1, "entries without a name are dropped");
  const ips = JSON.stringify([{ ip: "10.0.0.5", created: "x", source: "Server", expires: "forever", reason: "r" }, { name: "notAnIpEntry" }]);
  assert.equal(parseIpBanList(ips).length, 1, "entries without an ip are dropped");
});

test("upsert/remove are case-insensitive for names, exact for IPs, idempotent", () => {
  const banned = upsertBan([], "Griefer", "uuid-1", "  ", new Date(Date.UTC(2026, 0, 1)));
  assert.equal(banned.changed, true);
  assert.equal(banned.list[0].reason, DEFAULT_BAN_REASON, "blank reasons get the vanilla default");
  assert.equal(banned.list[0].expires, "forever");
  assert.equal(banned.list[0].source, "ServerHub");
  assert.equal(upsertBan(banned.list, "gRiEfEr", "uuid-2", "again").changed, false, "same player in any case is a no-op");
  assert.equal(removeBan(banned.list, "GRIEFER").changed, true);
  assert.equal(removeBan([], "Nobody").changed, false);

  const ipBanned = upsertIpBan([], "10.0.0.5", "proxy");
  assert.equal(ipBanned.changed, true);
  assert.equal(upsertIpBan(ipBanned.list, "10.0.0.5", "proxy").changed, false);
  assert.equal(removeIpBan(ipBanned.list, "10.0.0.5").changed, true);
  assert.equal(removeIpBan(ipBanned.list, "10.0.0.6").changed, false);
});

test("validBanIp: IPv4 with octet bounds, pragmatic IPv6, garbage rejected", () => {
  assert.equal(validBanIp("192.168.1.210"), true);
  assert.equal(validBanIp("255.255.255.255"), true);
  assert.equal(validBanIp("256.1.1.1"), false, "octets cap at 255");
  assert.equal(validBanIp("2001:db8::1"), true);
  assert.equal(validBanIp("::1"), true);
  assert.equal(validBanIp("Griefer"), false);
  assert.equal(validBanIp("10.0.0"), false);
  assert.equal(validBanIp(""), false);
});

test("banlistCommand maps to vanilla console syntax; wiring pins hold", () => {
  assert.equal(banlistCommand("ban", "Griefer", "stole the beacon"), "ban Griefer stole the beacon");
  assert.equal(banlistCommand("ban", "Griefer", "  "), "ban Griefer", "blank reason is omitted");
  assert.equal(banlistCommand("pardon", "Griefer", "ignored"), "pardon Griefer", "pardon never carries a reason");
  assert.equal(banlistCommand("ban-ip", "10.0.0.5", "vpn"), "ban-ip 10.0.0.5 vpn");
  assert.equal(banlistCommand("pardon-ip", "10.0.0.5"), "pardon-ip 10.0.0.5");

  const route = fs.readFileSync("src/app/api/servers/[id]/banlist/route.ts", "utf8");
  assert.ok(route.includes("runCommand(server, banlistCommand(action, target, reason)"), "live servers go through the console");
  assert.ok(route.includes('"banned-players.json"') && route.includes('"banned-ips.json"'), "offline edits touch both vanilla files");
  const filesys = fs.readFileSync("src/lib/filesys.ts", "utf8");
  assert.ok(filesys.includes('"banned-ips.json"'), "banned-ips.json is editable through the safe file layer");
  const page = fs.readFileSync("src/app/servers/[id]/players/page.tsx", "utf8");
  assert.ok(page.includes("BanlistManager"), "manager is mounted on the players page");
  console.log("BANLIST_SUITE_OK");
});

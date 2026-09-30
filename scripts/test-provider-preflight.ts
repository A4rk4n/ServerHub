import assert from "node:assert/strict";
import test from "node:test";
import { assignedLocalAddresses, isAssignedLocalAddress, validateDragonwildsPreflight } from "../src/lib/provider-preflight";

const interfaces = { Ethernet: [{ address: "192.168.1.210", netmask: "255.255.255.0", family: "IPv4" as const, mac: "00:00:00:00:00:00", internal: false, cidr: "192.168.1.210/24" }], Tunnel: [{ address: "fe80::1%12", netmask: "ffff:ffff:ffff:ffff::", family: "IPv6" as const, mac: "00:00:00:00:00:00", internal: false, cidr: "fe80::1/64", scopeid: 12 }] };

test("a well-formed Dragonwilds owner id and admin password pass preflight", () => {
  assert.doesNotThrow(() => validateDragonwildsPreflight("player-123", "admin-secret"));
});

test("malformed owner ids are rejected", () => {
  for (const owner of ["", "   ", "abc\nforged", "x".repeat(201)]) {
    assert.throws(() => validateDragonwildsPreflight(owner, "admin-secret"), /Player ID/);
  }
});

test("weak or forged admin passwords are rejected", () => {
  for (const password of ["", "1234", "valid\nforged"]) {
    assert.throws(() => validateDragonwildsPreflight("player-123", password), /admin password/);
  }
});

test("LAN bind addresses resolve against assigned local interfaces only", () => {
  assert.equal(isAssignedLocalAddress("192.168.1.210", interfaces), true);
  assert.equal(isAssignedLocalAddress("185.83.148.20", interfaces), false);
  assert.equal(isAssignedLocalAddress("FE80::1", interfaces), true);
  assert.equal(isAssignedLocalAddress("0.0.0.0", interfaces), true);
  assert.ok(assignedLocalAddresses(interfaces).has("127.0.0.1"));
  console.log("PROVIDER_PREFLIGHT_VALIDATION_OK");
});

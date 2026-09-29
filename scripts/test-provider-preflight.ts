import assert from "node:assert/strict";
import { assignedLocalAddresses,isAssignedLocalAddress,validateDragonwildsPreflight } from "../src/lib/provider-preflight";
assert.doesNotThrow(()=>validateDragonwildsPreflight("player-123","admin-secret"));
for(const owner of ["","   ","abc\nforged","x".repeat(201)])assert.throws(()=>validateDragonwildsPreflight(owner,"admin-secret"),/Player ID/);
for(const password of ["","1234","valid\nforged"])assert.throws(()=>validateDragonwildsPreflight("player-123",password),/admin password/);
const interfaces={Ethernet:[{address:"192.168.1.210",netmask:"255.255.255.0",family:"IPv4" as const,mac:"00:00:00:00:00:00",internal:false,cidr:"192.168.1.210/24"}],Tunnel:[{address:"fe80::1%12",netmask:"ffff:ffff:ffff:ffff::",family:"IPv6" as const,mac:"00:00:00:00:00:00",internal:false,cidr:"fe80::1/64",scopeid:12}]};
assert.equal(isAssignedLocalAddress("192.168.1.210",interfaces),true);assert.equal(isAssignedLocalAddress("185.83.148.20",interfaces),false);assert.equal(isAssignedLocalAddress("FE80::1",interfaces),true);assert.equal(isAssignedLocalAddress("0.0.0.0",interfaces),true);assert.ok(assignedLocalAddresses(interfaces).has("127.0.0.1"));
console.log("PROVIDER_PREFLIGHT_VALIDATION_OK");

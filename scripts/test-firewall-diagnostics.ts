import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFirewallRules, parseFirewallRules } from "../src/lib/firewall-diagnostics";

test("parseFirewallRules and evaluateFirewallRules enforce profile and state", () => {
  const rules = parseFirewallRules(JSON.stringify([
    { DisplayName: "Game", Enabled: true, Direction: "Inbound", Action: "Allow", Profile: "Private", Protocol: "17", LocalPort: "7777" },
    { DisplayName: "Wrong profile", Enabled: true, Direction: "Inbound", Action: "Allow", Profile: "Public", Protocol: "UDP", LocalPort: "27015" },
    { DisplayName: "Disabled", Enabled: false, Direction: "Inbound", Action: "Allow", Profile: "Private", Protocol: "TCP", LocalPort: "7777" },
  ]));
  const result = evaluateFirewallRules(
    [{ name: "Game", port: 7777, protocol: "UDP", required: true }, { name: "Query", port: 27015, protocol: "UDP", required: true }],
    rules,
  );
  assert.equal(result.configured, false);
  assert.equal(result.ports[0].configured, true);
  assert.equal(result.ports[1].configured, false);
  assert.deepEqual(result.ports[0].matchingRules, ["Game"]);
});

test("an Any-profile rule with a port list covers the required port", () => {
  const any = evaluateFirewallRules(
    [{ name: "Game", port: 7777, protocol: "UDP", required: true }],
    parseFirewallRules(JSON.stringify({ DisplayName: "Any", Enabled: "True", Direction: "Inbound", Action: "Allow", Profile: "Any", Protocol: "UDP", LocalPort: "7777, 7778" })),
  );
  assert.equal(any.configured, true);
});

test("empty rule output parses to an empty list", () => {
  assert.deepEqual(parseFirewallRules(""), []);
  console.log("WINDOWS_FIREWALL_DIAGNOSTICS_OK");
});

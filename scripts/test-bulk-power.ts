// Unit suite for bulk fleet power actions: eligibility rules, partition,
// start staggering, and the API/UI wiring.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { BULK_ACTIONS, BULK_LIMIT, START_STAGGER_MS, bulkActionEligible, partitionBulkAction, startDelaysMs } from "../src/lib/bulk-power";

const STATUSES = ["online", "offline", "starting", "restarting", "stopping", "installing", "crashed", "error"];

test("eligibility: start touches only stopped/failed servers, never busy ones", () => {
  const eligible = STATUSES.filter((status) => bulkActionEligible(status, "start"));
  assert.deepEqual(eligible.sort(), ["crashed", "error", "offline"]);
});

test("eligibility: stop covers running and starting servers plus queued restarts", () => {
  const eligible = STATUSES.filter((status) => bulkActionEligible(status, "stop"));
  assert.deepEqual(eligible.sort(), ["online", "restarting", "starting"]);
});

test("eligibility: restart never surprise-starts a stopped server", () => {
  const eligible = STATUSES.filter((status) => bulkActionEligible(status, "restart"));
  assert.deepEqual(eligible, ["online"]);
});

test("installing and updating servers are untouchable by every bulk action", () => {
  for (const action of BULK_ACTIONS) {
    assert.equal(bulkActionEligible("installing", action), false, `installing is safe from ${action}`);
    assert.equal(bulkActionEligible("updating", action), false, `updating is safe from ${action}`);
    assert.equal(bulkActionEligible("stopping", action), false, `stopping is safe from ${action}`);
  }
});

test("partition preserves order and loses no server", () => {
  const fleet = [
    { id: 1, status: "online" },
    { id: 2, status: "offline" },
    { id: 3, status: "crashed" },
    { id: 4, status: "installing" },
    { id: 5, status: "error" },
  ];
  const { eligible, skipped } = partitionBulkAction(fleet, "start");
  assert.deepEqual(eligible.map((s) => s.id), [2, 3, 5]);
  assert.deepEqual(skipped.map((s) => s.id), [1, 4]);
  assert.equal(eligible.length + skipped.length, fleet.length);
});

test("start delays are staggered at 2.5s intervals from an immediate first start", () => {
  assert.equal(START_STAGGER_MS, 2500);
  assert.deepEqual(startDelaysMs(0), []);
  assert.deepEqual(startDelaysMs(1), [0]);
  assert.deepEqual(startDelaysMs(4), [0, 2500, 5000, 7500]);
  assert.deepEqual(startDelaysMs(3, 1000), [0, 1000, 2000]);
  assert.ok(BULK_LIMIT >= 12, "the cap comfortably fits a realistic fleet");
});

test("the bulk route staggers starts, awaits stops, and the servers view shares the rules", () => {
  const route = fs.readFileSync("src/app/api/servers/bulk-power/route.ts", "utf8");
  assert.ok(route.includes("partitionBulkAction"), "route uses the shared partition");
  assert.ok(route.includes("startDelaysMs"), "starts are staggered");
  assert.ok(route.includes("setTimeout"), "staggered starts are scheduled, not awaited");
  assert.ok(route.includes("Promise.allSettled"), "stops/restarts settle independently");
  assert.ok(route.includes("BULK_LIMIT"), "request size is capped");
  const view = fs.readFileSync("src/components/servers-view.tsx", "utf8");
  assert.ok(view.includes("partitionBulkAction"), "the UI derives counts from the same rules");
  assert.ok(view.includes("bulk-power"), "the UI calls the bulk endpoint");
  assert.ok(view.includes("Confirm"), "bulk actions require a confirmation click");
  console.log("BULK_POWER_SUITE_OK");
});

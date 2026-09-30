import assert from "node:assert/strict";
import test from "node:test";
import { scheduledCommand } from "../src/lib/scheduled-actions";

test("scheduled commands render provider-safe syntax", () => {
  assert.equal(scheduledCommand("minecraft", "broadcast", "Hello players!"), "say Hello players!");
  assert.equal(scheduledCommand("custom", "command", "save-all"), "save-all");
});

test("control-character injection and unsupported broadcasts are rejected", () => {
  for (const value of ["hello\nstop", "hello; stop", ""]) {
    assert.throws(() => scheduledCommand("minecraft", "broadcast", value), value);
  }
  assert.throws(() => scheduledCommand("ark", "broadcast", "hello"));
  assert.throws(() => scheduledCommand("custom", "command", "save\nstop"));
  console.log("SCHEDULED_ACTION_COMMAND_SAFETY_OK");
});

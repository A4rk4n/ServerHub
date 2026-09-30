import assert from "node:assert/strict";
import test from "node:test";
import { moderationCommand } from "../src/lib/moderation";

test("moderation commands render provider-safe syntax", () => {
  assert.equal(moderationCommand("minecraft", "ban", "Ahri_123", "griefing"), "ban Ahri_123 griefing");
  assert.equal(moderationCommand("minecraft-modded", "unban", "Ahri"), "pardon Ahri");
});

test("injection through names, unsupported games, and reasons is rejected", () => {
  for (const name of ["Ahri;stop", "Ahri\nsay hi", "name with space", ""]) {
    assert.throws(() => moderationCommand("minecraft", "kick", name), name);
  }
  assert.throws(() => moderationCommand("ark", "ban", "Ahri"));
  assert.throws(() => moderationCommand("minecraft", "ban", "Ahri", "bad; stop"));
  console.log("MODERATION_COMMAND_SAFETY_OK");
});

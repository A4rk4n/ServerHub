import assert from "node:assert/strict";
import test from "node:test";
import { observationKey, reconcileObservationKeys } from "../src/lib/player-observations";

test("observationKey normalizes source and player names", () => {
  assert.equal(observationKey("steam-a2s", " Ahri "), "steam-a2s:ahri");
});

test("reconcileObservationKeys computes joins, leaves, and the online set", () => {
  assert.deepEqual(
    reconcileObservationKeys(["steam-a2s:ahri", "steam-a2s:poro"], ["steam-a2s:ahri", "steam-a2s:annie"]),
    { joined: ["steam-a2s:annie"], left: ["steam-a2s:poro"], online: ["steam-a2s:ahri", "steam-a2s:annie"] },
  );
  console.log("PLAYER_OBSERVATION_RECONCILIATION_OK");
});

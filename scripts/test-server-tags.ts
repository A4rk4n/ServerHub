import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MAX_TAGS_PER_SERVER,
  MAX_TAG_LENGTH,
  normalizeTag,
  normalizeTagList,
  readAllServerTags,
  readServerTags,
  tagCounts,
  writeServerTags,
} from "../src/lib/server-tags";

test("server tags: single-tag canonical form", () => {
  assert.equal(normalizeTag("Production"), "production");
  assert.equal(normalizeTag("  Big   Events  "), "big events");
  assert.equal(normalizeTag("modded-1_21"), "modded-1_21");
  // invalid shapes come back empty
  assert.equal(normalizeTag(""), "");
  assert.equal(normalizeTag("   "), "");
  assert.equal(normalizeTag("emoji 🎮"), "");
  assert.equal(normalizeTag("semi;colon"), "");
  assert.equal(normalizeTag("x".repeat(MAX_TAG_LENGTH + 1)), "");
  assert.equal(normalizeTag(42), "");
  assert.equal(normalizeTag(null), "");
});

test("server tags: list normalization", () => {
  assert.deepEqual(normalizeTagList(["Zebra", "apple", "APPLE", " apple ", "bad;tag", ""]), ["apple", "zebra"]);
  assert.deepEqual(normalizeTagList("not an array"), []);
  const flood = normalizeTagList(Array.from({ length: 30 }, (_, i) => `tag-${String(i).padStart(2, "0")}`));
  assert.equal(flood.length, MAX_TAGS_PER_SERVER);
  assert.deepEqual(tagCounts({ "1": ["prod", "events"], "2": ["prod"] }), { prod: 2, events: 1 });
});

test("server tags: sidecar round-trip", async () => {
  const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tags-"));
  assert.deepEqual(await readAllServerTags(base), {}, "missing file reads as empty");
  assert.deepEqual(await writeServerTags(3, ["Prod", "EU West"], base), ["eu west", "prod"]);
  assert.deepEqual(await readServerTags(3, base), ["eu west", "prod"]);
  // clearing the list removes the key entirely
  assert.deepEqual(await writeServerTags(3, [], base), []);
  assert.deepEqual(await readAllServerTags(base), {});
  // corrupt file degrades to empty, never throws
  await fs.promises.writeFile(path.join(base, "server-tags.json"), "{broken", "utf8");
  assert.deepEqual(await readAllServerTags(base), {});
  await fs.promises.rm(base, { recursive: true, force: true });
});

test("server tags: API + fleet wiring", () => {
  const route = fs.readFileSync("src/app/api/servers/[id]/tags/route.ts", "utf8");
  assert.ok(route.includes("Invalid JSON body"), "malformed JSON cannot wipe tags");
  assert.ok(route.includes("!Array.isArray(body.tags)"), "tags must be an explicit array");
  const serversRoute = fs.readFileSync("src/app/api/servers/route.ts", "utf8");
  assert.ok(serversRoute.includes('tags: allTags[String(server.id)] ?? []'), "the servers list carries tags");
  const overview = fs.readFileSync("src/lib/overview-data.ts", "utf8");
  assert.ok(overview.includes('tags: allTags[String(s.id)] ?? []'), "the overview cards carry tags");
  const view = fs.readFileSync("src/components/servers-view.tsx", "utf8");
  assert.ok(view.includes("tagFilter && !(s.tags ?? []).includes(tagFilter)"), "the fleet page filters by tag");
  console.log("SERVER_TAGS_SUITE_OK");
});

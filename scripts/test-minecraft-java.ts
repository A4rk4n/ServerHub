// Regression suite for Minecraft Java-runtime selection. Mojang switched
// to calendar versioning (26.1 after 1.21) in 2026 and raised the
// requirement to Java 25; the old parser assumed "1.x.y", treated "26.3"
// as minor=3 and launched modern servers under Java 8, crashing with
// UnsupportedClassVersionError (class file version 69.0 vs 52.0).

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { LATEST_JAVA_MAJOR, javaMajorForMinecraft } from "../src/lib/minecraft-java";

test("calendar-versioned releases and snapshots resolve to Java 25", () => {
  // The reported crash: a 26.x server launched under Java 8.
  assert.equal(javaMajorForMinecraft("26.3"), 25);
  assert.equal(javaMajorForMinecraft("26.1"), 25);
  assert.equal(javaMajorForMinecraft("26.4-snapshot-1"), 25);
  assert.equal(javaMajorForMinecraft("27.1"), 25, "future calendar years stay on the newest runtime");
  assert.equal(LATEST_JAVA_MAJOR, 25);
});

test("legacy 1.x releases keep their historical runtimes", () => {
  assert.equal(javaMajorForMinecraft("1.12.2"), 8);
  assert.equal(javaMajorForMinecraft("1.16.5"), 8);
  assert.equal(javaMajorForMinecraft("1.17.1"), 17);
  assert.equal(javaMajorForMinecraft("1.18.2"), 17);
  assert.equal(javaMajorForMinecraft("1.20.4"), 17);
  assert.equal(javaMajorForMinecraft("1.20.5"), 21, "the Java 21 boundary is 1.20.5");
  assert.equal(javaMajorForMinecraft("1.20.6"), 21);
  assert.equal(javaMajorForMinecraft("1.21"), 21);
  assert.equal(javaMajorForMinecraft("1.21.4"), 21);
  assert.equal(javaMajorForMinecraft("1.21.4-rc1"), 21, "pre-release suffixes parse");
});

test("weekly snapshots map by development era", () => {
  assert.equal(javaMajorForMinecraft("20w06a"), 8);
  assert.equal(javaMajorForMinecraft("21w37a"), 17);
  assert.equal(javaMajorForMinecraft("23w51b"), 17);
  assert.equal(javaMajorForMinecraft("24w14a"), 21);
  assert.equal(javaMajorForMinecraft("25w10a"), 21);
  assert.equal(javaMajorForMinecraft("26w05a"), 25);
});

test("unknown versions get the newest runtime, never Java 8", () => {
  // Modern JVMs run older class files; the reverse always crashes —
  // so the safe default for anything unrecognized is the newest Java.
  for (const version of ["latest", "unknown", "", "totally-custom", "2.0"]) {
    assert.equal(javaMajorForMinecraft(version), LATEST_JAVA_MAJOR, `"${version}" must not fall back to Java 8`);
  }
});

test("the runtime uses the shared mapper and the old parser is gone", () => {
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes('from "./minecraft-java"'), "runtime imports the tested mapper");
  assert.ok(!runtime.includes('version.split(".").map(Number)'), "the naive 1.x.y parser is removed");
  console.log("MINECRAFT_JAVA_MAPPING_OK");
});

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { hostPlatform } from "../src/lib/host-platform";

test("SERVERHUB_TARGET_PLATFORM overrides the detected host platform safely", () => {
  const before = process.env.SERVERHUB_TARGET_PLATFORM;
  try {
    process.env.SERVERHUB_TARGET_PLATFORM = "win32";
    assert.equal(hostPlatform(), "win32");
    process.env.SERVERHUB_TARGET_PLATFORM = "linux";
    assert.equal(hostPlatform(), "linux");
    process.env.SERVERHUB_TARGET_PLATFORM = "forged";
    assert.equal(hostPlatform(), process.platform);
  } finally {
    if (before === undefined) delete process.env.SERVERHUB_TARGET_PLATFORM;
    else process.env.SERVERHUB_TARGET_PLATFORM = before;
  }
});

test("the portable launcher pins the cross-compiled Windows platform", () => {
  const launcher = fs.readFileSync("scripts/portable-launcher.cjs", "utf8");
  assert.ok(launcher.includes("SERVERHUB_TARGET_PLATFORM = \"win32\""));
});

test("platform-branching code never branches on process.platform directly", () => {
  for (const file of ["src/lib/runtime.ts", "src/app/api/tools/route.ts", "src/app/api/tools/[id]/repair/route.ts", "src/lib/windows-authenticode.ts"]) {
    assert.ok(!fs.readFileSync(file, "utf8").includes("process.platform"), file);
  }
  console.log("CROSS_COMPILED_PLATFORM_REGRESSION_OK");
});

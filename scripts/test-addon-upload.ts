// Manual mod upload (addon-upload.ts): name validation, display naming,
// the size cap, and the route/UI wiring pins.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { MAX_MOD_UPLOAD_BYTES, modNameFromFileName, validateModUploadName } from "../src/lib/addon-upload";

test("validateModUploadName accepts real mod file names", () => {
  for (const name of ["lithium-fabric-0.14.3.jar", "My Pack v2.zip", "sodium+indium-1.0.JAR", "a.jar"]) {
    assert.equal(validateModUploadName(name), null, `${name} is valid`);
  }
});

test("validateModUploadName rejects traversal, wrong types, and garbage", () => {
  assert.match(validateModUploadName("../../evil.jar") ?? "", /path separators/);
  assert.match(validateModUploadName("mods/evil.jar") ?? "", /path separators/);
  assert.match(validateModUploadName("evil\\evil.jar") ?? "", /path separators/);
  assert.match(validateModUploadName("mod.exe") ?? "", /\.jar or \.zip/);
  assert.match(validateModUploadName("mod.jar.exe") ?? "", /\.jar or \.zip/);
  assert.match(validateModUploadName(".hidden.jar") ?? "", /starting with a letter or digit/);
  assert.match(validateModUploadName(`${"x".repeat(250)}.jar`) ?? "", /\.jar or \.zip/);
  assert.match(validateModUploadName("") ?? "", /no file name/);
  assert.match(validateModUploadName(42) ?? "", /no file name/);
});

test("display name strips only the extension; the cap is 100 MB", () => {
  assert.equal(modNameFromFileName("lithium-fabric-0.14.3.jar"), "lithium-fabric-0.14.3");
  assert.equal(modNameFromFileName("pack.v2.ZIP"), "pack.v2");
  assert.equal(MAX_MOD_UPLOAD_BYTES, 100 * 1024 * 1024);
});

test("route and manager wiring", () => {
  const route = fs.readFileSync("src/app/api/servers/[id]/addons/upload/route.ts", "utf8");
  assert.ok(route.includes("validateModUploadName(file.name)"), "names are validated before any filesystem work");
  assert.ok(route.includes("MAX_MOD_UPLOAD_BYTES") && route.includes("413"), "oversize uploads get 413");
  assert.ok(route.includes('`${relative}.disabled`'), "duplicate detection sees disabled mods too");
  assert.ok(route.indexOf("writeFile(temporary") < route.indexOf("rename(temporary"), "temp-then-rename: no partial files in mods/");
  assert.ok(route.includes('projectId: ""'), "manual uploads stay out of the update checker by design");
  const ui = fs.readFileSync("src/components/addons-manager.tsx", "utf8");
  assert.ok(ui.includes('accept=".jar,.zip"') && ui.includes("addons/upload"), "manager has the upload control");
  console.log("ADDON_UPLOAD_SUITE_OK");
});

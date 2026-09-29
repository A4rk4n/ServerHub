import assert from "node:assert/strict";
import fs from "node:fs";

const usage=fs.readFileSync("src/lib/tool-usage.ts","utf8");
for(const id of ["steamcmd","java","powershell","webview2","hytale-downloader"]) assert.ok(usage.includes(`"${id}"`));
assert.ok(usage.includes('replace(/[\\r\\n\\0]/g, " ")'));
assert.ok(usage.includes("slice(0, 240)"));
const runtime=fs.readFileSync("src/lib/runtime.ts","utf8");
assert.ok(runtime.includes('recordSuccessfulToolUse("java"'));
assert.ok(runtime.includes('recordSuccessfulToolUse("powershell"'));
assert.ok(runtime.indexOf('recordSuccessfulToolUse("java"')>runtime.indexOf('Provider readiness probe passed'));
const launcher=fs.readFileSync("scripts/portable-launcher.cjs","utf8");
assert.ok(launcher.includes('mainWebview.once("page-load-finished"'));
assert.ok(launcher.includes('action: "record-native-use", toolId: "webview2"'));
const route=fs.readFileSync("src/app/api/tools/route.ts","utf8");
assert.ok(route.includes('body.toolId!=="webview2"'));
assert.ok(route.includes('x-serverhub-native-shell'));
console.log("TOOL_SUCCESSFUL_USE_TRACKING_OK");

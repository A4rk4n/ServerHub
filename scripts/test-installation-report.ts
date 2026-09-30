import assert from "node:assert/strict";
import test from "node:test";
import { createInstallationReport } from "../src/lib/installation-report";

test("installation reports stay copyable, complete, and privacy-safe", () => {
  const report = createInstallationReport(
    { id: 9, attempt: 2, status: "failed", phase: "installing", progress: 25, message: "Installing", error: "Failed at C:\\Users\\Ahri\\ServerHub password=secret" },
    [{ level: "error", phase: "installing", progress: 25, message: "ownerId=abc123\nfailed" }],
    ["C:\\Users\\Ahri\\ServerHub"],
  );
  assert.ok(report.includes("Job: 9"));
  assert.ok(report.includes("Attempt: 2"));
  assert.ok(report.includes("<private-path>"));
  assert.ok(report.includes("password=[redacted]"));
  assert.ok(report.includes("ownerId=[redacted]"));
  assert.ok(!report.includes("Ahri"));
  assert.ok(!report.includes("secret"));
  assert.ok(!report.includes("abc123"));
  assert.equal(report.endsWith("\n"), true);
  console.log("INSTALLATION_DIAGNOSTIC_REPORT_OK");
});

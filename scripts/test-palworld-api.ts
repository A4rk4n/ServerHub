// Unit suite for the Palworld REST API client and the graceful-stop
// wiring: request shapes, auth, loopback-only targeting, per-step
// results, and the runtime/ini integration.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { palworldApiRequest, palworldAuthorization, palworldGracefulStop, palworldRestPort } from "../src/lib/palworld-api";

test("the REST port is derived from the game port, matching the game's own defaults", () => {
  assert.equal(palworldRestPort(8211), 8212);
  assert.equal(palworldRestPort(27000), 27001);
});

test("authorization is HTTP Basic with the literal username admin", () => {
  assert.equal(palworldAuthorization("secret-pw"), `Basic ${Buffer.from("admin:secret-pw").toString("base64")}`);
  assert.equal(palworldAuthorization("secret-pw"), "Basic YWRtaW46c2VjcmV0LXB3");
});

test("requests target loopback only, POST JSON, and are time-bounded", () => {
  const request = palworldApiRequest(8212, "shutdown", "pw", { waittime: 10, message: "bye" });
  assert.equal(request.url, "http://127.0.0.1:8212/v1/api/shutdown");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(JSON.parse(String(request.init.body)), { waittime: 10, message: "bye" });
  const headers = request.init.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  assert.ok(headers.Authorization.startsWith("Basic "));
  assert.ok(request.init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(String(palworldApiRequest(8212, "save", "pw").init.body)), {});
});

function fetchStub(results: Array<boolean | Error>) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const result = results[calls.length - 1];
    if (result instanceof Error) throw result;
    return { ok: result } as Response;
  }) as typeof fetch;
  return { calls, impl };
}

test("a graceful stop saves the world first, then requests a countdown shutdown", async () => {
  const stub = fetchStub([true, true]);
  const result = await palworldGracefulStop({ gamePort: 8211, adminPassword: "pw", waitSeconds: 10, fetchImpl: stub.impl });
  assert.deepEqual(result, { saved: true, shutdown: true });
  assert.equal(stub.calls.length, 2);
  assert.equal(stub.calls[0].url, "http://127.0.0.1:8212/v1/api/save");
  assert.equal(stub.calls[1].url, "http://127.0.0.1:8212/v1/api/shutdown");
  const body = stub.calls[1].body as { waittime: number; message: string };
  assert.equal(body.waittime, 10);
  assert.ok(body.message.includes("10 seconds"));
});

test("per-step failures are reported without aborting the other step", async () => {
  assert.deepEqual(
    await palworldGracefulStop({ gamePort: 8211, adminPassword: "pw", fetchImpl: fetchStub([false, true]).impl }),
    { saved: false, shutdown: true }
  );
  assert.deepEqual(
    await palworldGracefulStop({ gamePort: 8211, adminPassword: "pw", fetchImpl: fetchStub([new Error("refused"), true]).impl }),
    { saved: false, shutdown: true }
  );
  assert.deepEqual(
    await palworldGracefulStop({ gamePort: 8211, adminPassword: "pw", fetchImpl: fetchStub([new Error("refused"), new Error("refused")]).impl }),
    { saved: false, shutdown: false }
  );
});

test("without an admin password no request is ever sent", async () => {
  const stub = fetchStub([]);
  assert.deepEqual(await palworldGracefulStop({ gamePort: 8211, adminPassword: "", fetchImpl: stub.impl }), { saved: false, shutdown: false });
  assert.equal(stub.calls.length, 0);
});

test("stopFlow prefers the REST shutdown for Palworld and keeps its force-kill backstop", () => {
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  const flow = runtime.slice(runtime.indexOf("export async function stopFlow"), runtime.indexOf("export async function restartFlow"));
  assert.ok(flow.includes("palworldGracefulStop"), "stopFlow calls the REST client");
  assert.ok(flow.includes("revealSecret(entry.server.adminPassword)"), "the admin password is decrypted from the vault");
  assert.ok(flow.indexOf("palworldGracefulStop") < flow.indexOf("stdin.write"), "REST is attempted before the stdin fallback");
  assert.ok(flow.includes("killProcessTree"), "the 30s force-kill backstop remains");
  // The managed ini enables the REST API only when an admin password exists.
  assert.ok(runtime.includes('"RESTAPIEnabled=True" : "RESTAPIEnabled=False"'));
  assert.ok(runtime.includes("RESTAPIPort=${palworldRestPort(server.port)}"));
  console.log("PALWORLD_REST_STOP_OK");
});

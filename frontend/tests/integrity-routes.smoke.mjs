import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const NEXT = new URL("../node_modules/.bin/next", import.meta.url).pathname;

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function start(overrides) {
  const port = await freePort();
  // Each server gets its own durable decision dir so runs never share decided proposals.
  const env = { ...process.env, INTEGRITY_COPILOT_DATA_DIR: mkdtempSync(join(tmpdir(), "icp-smoke-")), ...overrides };
  for (const key of ["MODEL_API_KEY", "INTEGRITY_COPILOT_APPROVER_TOKEN"]) {
    if (env[key] === "__UNSET__") delete env[key];
  }
  const logs = [];
  const child = spawn(NEXT, ["start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited ${child.exitCode}:\n${logs.join("")}`);
    try {
      await fetch(`${base}/api/integrity-copilot/replay`);
      return { child, base, logs };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  child.kill("SIGTERM");
  throw new Error(`next start did not become ready:\n${logs.join("")}`);
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error("next start did not stop")), 5_000)),
  ]);
}

async function json(response) {
  return { status: response.status, body: await response.json() };
}

async function main() {
  const unconfigured = await start({
    INTEGRITY_COPILOT_LIVE: "1",
    INTEGRITY_COPILOT_APPROVER_TOKEN: "__UNSET__",
    MODEL_API_KEY: "__UNSET__",
  });
  try {
    const result = await json(await fetch(`${unconfigured.base}/api/integrity-copilot/replay`));
    assert.equal(result.status, 503);
    assert.match(result.body.error, /approval_not_configured/);
  } finally {
    await stop(unconfigured.child);
  }

  // API narrative with no key: hermetic (no local model, no network), explicit unavailable.
  const configured = await start({
    INTEGRITY_COPILOT_LIVE: "1",
    INTEGRITY_COPILOT_MUSE: "api",
    INTEGRITY_COPILOT_APPROVER_TOKEN: "route-test-secret",
    MODEL_API_KEY: "__UNSET__",
  });
  try {
    let result = await json(await fetch(`${configured.base}/api/integrity-copilot/replay`));
    assert.equal(result.status, 401);

    result = await json(
      await fetch(`${configured.base}/api/integrity-copilot/replay`, {
        headers: { "x-integrity-copilot-token": "route-test-secret" },
      })
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.meta_summary.status, "unavailable");
    assert.equal(result.body.meta_summary.reason, "not_configured");

    result = await json(
      await fetch(`${configured.base}/api/integrity-copilot/decide`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-integrity-copilot-token": "wrong" },
        body: JSON.stringify({}),
      })
    );
    assert.equal(result.status, 401);

    result = await json(
      await fetch(`${configured.base}/api/integrity-copilot/decide`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-integrity-copilot-token": "route-test-secret" },
        body: "not-json",
      })
    );
    assert.equal(result.status, 400);

    result = await json(
      await fetch(`${configured.base}/api/integrity-copilot/decide`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-integrity-copilot-token": "route-test-secret" },
        body: JSON.stringify({ proposal_id: "PROP-PC-01-P-101", engineer: "", rationale: "", decision: "approved" }),
      })
    );
    assert.equal(result.status, 422);
    assert.ok(result.body.errors.some((error) => /named engineer/.test(error)));
    assert.ok(result.body.errors.some((error) => /rationale/.test(error)));

    result = await json(
      await fetch(`${configured.base}/api/integrity-copilot/decide`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-integrity-copilot-token": "route-test-secret" },
        body: JSON.stringify({ proposal_id: "PROP-PC-01-P-101", engineer: "Route Tester", rationale: "Verified test decision", decision: "approved" }),
      })
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.proposal.status, "approved");
    assert.equal(result.body.proposal.approval.engineer, "Route Tester");

    result = await json(
      await fetch(`${configured.base}/api/integrity-copilot/decide`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-integrity-copilot-token": "route-test-secret" },
        body: JSON.stringify({ proposal_id: "PROP-PC-01-P-101", engineer: "Route Tester", rationale: "repeat", decision: "rejected" }),
      })
    );
    assert.equal(result.status, 422);
    assert.ok(result.body.errors.some((error) => /already decided/.test(error)));
  } finally {
    await stop(configured.child);
  }

  console.log("PASS: Integrity Copilot route smoke tests (503, 401, 400, 422, live gate, approve, repeat)");
}

await main();

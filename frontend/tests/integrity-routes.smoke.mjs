import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync } from "node:fs";
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

    // Portfolio ranking and line selection (route coverage, C-027).
    const LINE_A = "SYN/FPSOT/GAS/COMP/IPN-_NG-0610-30-S710";
    result = await json(await fetch(`${configured.base}/api/integrity-copilot/portfolio`));
    assert.equal(result.status, 200);
    assert.equal(result.body.lines.length, 3, "legacy PC-01 is not part of the portfolio");
    assert.deepEqual(result.body.spots.map((s) => `${s.tier}:${s.location_id}`), ["2:A-02", "3:B-02", "4:C-01", "5:B-01", "5:C-02", "5:A-01", "5:A-03"]);
    result = await json(await fetch(`${configured.base}/api/integrity-copilot/replay`, { headers: { "x-integrity-copilot-token": "route-test-secret", "x-integrity-copilot-line": LINE_A } }));
    assert.equal(result.status, 200);
    assert.equal(result.body.line.line_number, "NG-18-50110-S710");
    result = await json(await fetch(`${configured.base}/api/integrity-copilot/replay`, { headers: { "x-integrity-copilot-token": "route-test-secret", "x-integrity-copilot-line": "NO-SUCH-LINE" } }));
    assert.equal(result.status, 404);

    // Campaign import (route coverage, C-028).
    const csv = readFileSync(new URL("../public/templates/example-ut-campaign-line-A.csv", import.meta.url), "utf8");
    const campaign = { work_order: "71000005", technique: "UTM-01-100%", read_date: "2025-10-20", performer: "Route Tester", procedure_id: "PROC-SYN-UT-01", procedure_revision: "A", instrument_id: "UTI-SYN-1", calibration_ref: "CAL-SYN-2025b", measurement_uncertainty_mm: "0.2", quality: "good" };
    const comparability = { decided_by: "Route Tester", rationale: "Same procedure and instrument (test)." };
    const upload = (token, body) => fetch(`${configured.base}/api/integrity-copilot/upload`, { method: "POST", headers: { "content-type": "application/json", "x-integrity-copilot-token": token }, body: JSON.stringify(body) });
    assert.equal((await upload("wrong-token", { csv, campaign })).status, 401);
    const nullBody = await fetch(`${configured.base}/api/integrity-copilot/upload`, { method: "POST", headers: { "content-type": "application/json", "x-integrity-copilot-token": "route-test-secret" }, body: "null" });
    assert.equal(nullBody.status, 400, "a JSON null body is a 400, not a crash");
    assert.equal((await upload("route-test-secret", { csv, campaign: { ...campaign, work_order: "FUTURE-1", read_date: "2099-01-01" } })).status, 422, "future-dated import refused");
    const beforeImport = Date.now();
    result = await json(await upload("route-test-secret", { csv, campaign, comparability }));
    assert.equal(result.status, 200);
    assert.equal(result.body.accepted_rows, 3);
    assert.equal((await upload("route-test-secret", { csv, campaign })).status, 422, "duplicate work order");
    result = await json(await fetch(`${configured.base}/api/integrity-copilot/portfolio`));
    const a2 = result.body.spots.find((s) => s.location_id === "A-02");
    assert.ok(a2.remaining_life_years < 1, `A-02 after import: ${a2.remaining_life_years}`);
    assert.match(result.body.label, /Includes 1 uploaded campaign/);
    // Temporal contract (C-029): the snapshot advances to the import time; nothing in it is later.
    assert.ok(Date.parse(result.body.as_of) >= beforeImport, `as_of ${result.body.as_of} must be the import time`);
    assert.equal(a2.tier, 1, "as of the import date, A-02's next inspection (2026-03-04) is overdue");
    assert.ok(a2.reasons.some((r) => /next inspection was due 2026-03-04/.test(r)), a2.reasons.join(" | "));
  } finally {
    await stop(configured.child);
  }

  console.log("PASS: Integrity Copilot route smoke tests (503, 401, 400, 422, live gate, approve, repeat, portfolio, line select, import)");
}

await main();

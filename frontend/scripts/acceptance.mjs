import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = new URL(process.env.BASE_URL ?? "http://localhost:3198");
const approverToken = process.env.ACCEPTANCE_APPROVER_TOKEN ?? process.env.INTEGRITY_COPILOT_APPROVER_TOKEN ?? "acceptance-only-token";
const nextBin = new URL("../node_modules/.bin/next", import.meta.url).pathname;
let server;
const dataDir = mkdtempSync(join(tmpdir(), "integrity-copilot-acceptance-"));

async function request(path, init) {
  return fetch(new URL(path, baseUrl), init);
}

async function isRunning() {
  try {
    const response = await request("/");
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await isRunning()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`next start did not become ready at ${baseUrl}`);
}

async function startServerIfNeeded() {
  if (await isRunning()) return false;
  assert.equal(baseUrl.protocol, "http:", "self-start supports an http BASE_URL");
  assert.ok(baseUrl.port, "self-start requires BASE_URL to contain an explicit port");
  const env = {
    ...process.env,
    HOSTNAME: baseUrl.hostname,
    PORT: baseUrl.port,
    INTEGRITY_COPILOT_LIVE: "0",
    INTEGRITY_COPILOT_APPROVER_TOKEN: approverToken,
    INTEGRITY_COPILOT_DATA_DIR: dataDir,
  };
  delete env.MODEL_API_KEY;
  server = spawn(nextBin, ["start", "-H", baseUrl.hostname, "-p", baseUrl.port], { env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (chunk) => process.stdout.write(`[next] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));
  await waitForServer();
  return true;
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error("next start did not stop within 5 seconds")), 5_000)),
  ]);
}

async function body(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function cml03(payload) {
  return payload.trends?.find((trend) => trend.location_id === "CML-03");
}

async function run() {
  const started = await startServerIfNeeded();
  console.log(`${started ? "Started" : "Targeting"} next start at ${baseUrl}`);
  const failures = [];

  async function check(name, fn) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
      console.error(`FAIL ${name}: ${error.message}`);
    }
  }

  let proposalId;
  await check("GET / renders the Integrity Copilot workbench", async () => {
    const response = await request("/");
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Integrity Copilot/);
    assert.match(html, /Re-run replay/);
  });

  await check("GET replay returns the deterministic CML-03 result and explicit Meta unavailability", async () => {
    // Replay is a read: GET (the POST contract came from a wrong dispatch prompt; see C-007).
    const response = await request("/api/integrity-copilot/replay");
    const payload = await body(response);
    assert.equal(response.status, 200, `expected 200, got ${response.status}: ${JSON.stringify(payload)}`);
    const trend = cml03(payload);
    assert.ok(trend, "CML-03 trend is missing");
    assert.equal(trend.governing.rate_mm_per_year, 0.1875);
    assert.equal(trend.threshold.remaining_life_years, 16);
    assert.equal(trend.next_inspection_due, "2032-01-01T00:00:00.000Z");
    assert.equal(payload.meta_summary?.status, "unavailable");
    assert.equal(payload.meta_summary?.reason, "not_configured");
    assert.ok(Array.isArray(payload.data_gaps) && payload.data_gaps.length > 0, "data gaps must be present");
    assert.ok(payload.process_samples?.some((sample) => sample.value === null), "missing process data must remain null, not zero-filled");
    assert.ok(!payload.process_samples?.some((sample) => sample.value === 0), "missing process data was zero-filled");
    proposalId = payload.proposal?.id;
  });

  // Discover the proposal over the public HTTP API even if the replay check failed,
  // so every decision assertion still runs and reports independently.
  if (!proposalId) {
    const response = await request("/api/integrity-copilot/replay");
    const payload = await body(response);
    if (response.ok) proposalId = payload.proposal?.id;
  }

  await check("decide rejects missing token", async () => {
    const response = await request("/api/integrity-copilot/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proposal_id: proposalId, engineer: "A. Reviewer", rationale: "Acceptance check", decision: "approved" }),
    });
    assert.equal(response.status, 401);
  });

  async function decide(input) {
    return request("/api/integrity-copilot/decide", {
      method: "POST",
      headers: { "content-type": "application/json", "x-integrity-copilot-token": approverToken },
      body: JSON.stringify({ proposal_id: proposalId, decision: "approved", ...input }),
    });
  }

  await check("decide rejects missing engineer name", async () => {
    const response = await decide({ rationale: "Acceptance check" });
    assert.equal(response.status, 422, JSON.stringify(await body(response)));
  });

  await check("decide rejects missing rationale", async () => {
    const response = await decide({ engineer: "A. Reviewer" });
    assert.equal(response.status, 422, JSON.stringify(await body(response)));
  });

  await check("decide accepts one valid decision", async () => {
    assert.ok(proposalId, "replay did not provide a proposal id");
    const accepted = await decide({ engineer: "A. Reviewer", rationale: "CML-03 acceptance evidence verified" });
    const acceptedBody = await body(accepted);
    assert.equal(accepted.status, 200, JSON.stringify(acceptedBody));
  });

  await check("decision survives restart and remains single use", async () => {
    assert.equal(started, true, "restart-persistence acceptance requires the harness to self-start the server");
    await stopServer();
    server = undefined;
    assert.equal(await startServerIfNeeded(), true, "server did not restart under harness control");

    const replayed = await request("/api/integrity-copilot/replay");
    const replayedBody = await body(replayed);
    assert.equal(replayed.status, 200, JSON.stringify(replayedBody));
    assert.equal(replayedBody.proposal?.status, "approved");

    const repeated = await decide({ engineer: "A. Reviewer", rationale: "Attempted duplicate after restart" });
    const repeatedBody = await body(repeated);
    assert.equal(repeated.status, 422, JSON.stringify(repeatedBody));
    assert.match(JSON.stringify(repeatedBody), /already decided/i);
  });

  for (const path of ["/api/chat", "/api/analyze-bedrock", "/api/agent/dispatch"]) {
    await check(`${path} is absent`, async () => {
      const response = await request(path);
      assert.equal(response.status, 404);
    });
  }

  if (failures.length) throw new Error(`Acceptance failed (${failures.length}):\n- ${failures.join("\n- ")}`);
  console.log("PASS black-box acceptance");
}

try {
  await run();
} finally {
  await stopServer();
  rmSync(dataDir, { recursive: true, force: true });
}

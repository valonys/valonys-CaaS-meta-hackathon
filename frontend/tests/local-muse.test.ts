import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BudgetLedger, LOCAL_MUSE_URL, MetaGateway, ResponseCache, gatewayFromEnv, localModelMatches } from "../lib/integrity-copilot/gateway.ts";
import { runReplay, type CircuitFixture } from "../lib/integrity-copilot/workflow.ts";

const fx = JSON.parse(readFileSync(new URL("../lib/integrity-copilot/fixtures/synthetic-circuit.json", import.meta.url), "utf8")) as CircuitFixture;
const ALIASED = readFileSync(new URL("../lib/integrity-copilot/fixtures/live-summary-aliased-2026-10-30.txt", import.meta.url), "utf8");
const NOW = () => new Date("2026-10-29T09:00:00Z");
const chat = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status });
const ok = (content: string) => chat({ model: "muse-glimmer:latest", message: { role: "assistant", content }, done: true, done_reason: "stop", prompt_eval_count: 600, eval_count: 300 });

function capture(responses: Response[]) {
  const calls: { url: string; body: any }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const r = responses.shift();
    if (!r) throw new Error("unexpected extra call");
    return r;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("env: live mode defaults the narrative to local muse-glimmer; API Muse only when selected", () => {
  const local = gatewayFromEnv({ INTEGRITY_COPILOT_LIVE: "1" });
  assert.equal(local.narrativeModel, "muse-glimmer");
  assert.equal(local.canServe("muse-glimmer"), true);
  assert.equal(local.canServe("sam-3.1"), false, "no key: SAM stays recorded");
  assert.equal(gatewayFromEnv({}).canServe("muse-glimmer"), false, "replay mode calls nothing");
  assert.equal(gatewayFromEnv({ INTEGRITY_COPILOT_LIVE: "1", INTEGRITY_COPILOT_MUSE: "api" }).narrativeModel, "muse-spark-1.3");
  // A key in the environment is ignored unless a paid call is explicitly requested.
  assert.equal(gatewayFromEnv({ INTEGRITY_COPILOT_LIVE: "1", MODEL_API_KEY: "k" }).canServe("sam-3.1"), false);
  assert.equal(gatewayFromEnv({ INTEGRITY_COPILOT_LIVE: "1", MODEL_API_KEY: "k", INTEGRITY_COPILOT_SAM: "live" }).canServe("sam-3.1"), true);
  assert.equal(gatewayFromEnv({ INTEGRITY_COPILOT_LIVE: "1", MODEL_API_KEY: "k", INTEGRITY_COPILOT_MUSE: "api" }).canServe("muse-spark-1.3"), true);
});

test("local Muse: loopback only, no key sent, no paid call; workflow shows the guarded narrative", async () => {
  const f = capture([ok(ALIASED)]);
  const g = new MetaGateway({ local: true, fetchImpl: f.impl });
  const r = await runReplay(fx, g, NOW);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, LOCAL_MUSE_URL);
  assert.ok(LOCAL_MUSE_URL.startsWith("http://127.0.0.1:"));
  assert.equal(f.calls[0].body.model, "muse-glimmer");
  assert.equal(f.calls[0].body.stream, false);
  assert.equal(/\p{N}/u.test(f.calls[0].body.messages[1].content), false, "masked request carries no digit");
  assert.equal(r.meta_summary.status, "ok", JSON.stringify(r.meta_summary));
  assert.equal(r.meta_summary.status === "ok" && r.meta_summary.model_id, "muse-glimmer:latest");
  assert.equal(g.spent.estimated_usd, 0);
  assert.equal(g.usage[0].endpoint, "local-chat");
});

test("local Muse: numeric guard still applies to local output", async () => {
  const r = await runReplay(fx, new MetaGateway({ local: true, fetchImpl: capture([ok("CML#a remaining life 18 years.")]).impl }), NOW);
  assert.ok(r.meta_summary.status === "error" && r.meta_summary.reason === "unfaithful");
});

test("local Muse: cut-off, wrong model, bad usage, HTTP and unreachable are explicit errors", async () => {
  const cases: [Response | Error, string][] = [
    [chat({ model: "muse-glimmer:latest", message: { content: "x" }, done_reason: "length", eval_count: 10 }), "incomplete"],
    [chat({ model: "other-model:latest", message: { content: "x" }, done_reason: "stop" }), "malformed_response"],
    [chat({ model: "muse-glimmer", message: { content: "x" }, done_reason: "stop", eval_count: -1 }), "malformed_response"],
    [chat({ model: "muse-glimmer", message: { content: "" }, done_reason: "stop" }), "malformed_response"],
    [chat({}, 500), "http"],
  ];
  for (const [resp, reason] of cases) {
    const g = new MetaGateway({ local: true, fetchImpl: (async () => resp) as unknown as typeof fetch });
    const out = await g.respond({ model: "muse-glimmer", input: "x", evidence_ids: [] });
    assert.ok(out.status === "error" && out.reason === reason, `${reason}: ${JSON.stringify(out)}`);
  }
  const down = new MetaGateway({ local: true, fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch });
  const out = await down.respond({ model: "muse-glimmer", input: "x", evidence_ids: [] });
  assert.ok(out.status === "error" && /not reachable/.test(out.detail));
});

test("local Muse: not enabled -> unavailable without any request; cache hit needs no call slot", async () => {
  const off = new MetaGateway({ fetchImpl: (async () => { throw new Error("must not call"); }) as unknown as typeof fetch });
  assert.equal((await off.respond({ model: "muse-glimmer", input: "x", evidence_ids: [] })).status, "unavailable");
  const cache = new ResponseCache();
  const f = capture([ok("CML#a governs.")]);
  const g = new MetaGateway({ local: true, fetchImpl: f.impl, cache, ledger: new BudgetLedger({ maxCalls: 1 }) });
  const req = { model: "muse-glimmer", input: "same", evidence_ids: [] };
  assert.equal((await g.respond(req)).status, "ok");
  assert.equal((await g.respond(req)).status, "ok");
  assert.equal(f.calls.length, 1);
  assert.equal(g.usage[1].detail, "cache_hit");
});

test("local model echo accepts name or name:tag only", () => {
  assert.ok(localModelMatches("muse-glimmer", "muse-glimmer"));
  assert.ok(localModelMatches("muse-glimmer", "muse-glimmer:30b-q4_K_M"));
  assert.ok(!localModelMatches("muse-glimmer", "muse-glimmer-x:latest"));
  assert.ok(!localModelMatches("muse-glimmer", "other:latest"));
});

test("C-019 P1: each paid model needs its own opt-in (SAM does not unlock Muse Spark, nor vice versa)", async () => {
  const stub = (async () => { throw new Error("must not call the API"); }) as unknown as typeof fetch;
  const samOnly = gatewayFromEnv({ INTEGRITY_COPILOT_LIVE: "1", INTEGRITY_COPILOT_SAM: "live", MODEL_API_KEY: "k" });
  (samOnly as unknown as { cfg: { fetchImpl: typeof fetch } }).cfg.fetchImpl = stub;
  assert.equal(samOnly.canServe("muse-spark-1.3"), false);
  const r1 = await samOnly.respond({ model: "muse-spark-1.3", input: "x", evidence_ids: [] });
  assert.ok(r1.status === "unavailable" && /not enabled/.test(r1.detail), JSON.stringify(r1));
  const museOnly = gatewayFromEnv({ INTEGRITY_COPILOT_LIVE: "1", INTEGRITY_COPILOT_MUSE: "api", MODEL_API_KEY: "k" });
  (museOnly as unknown as { cfg: { fetchImpl: typeof fetch } }).cfg.fetchImpl = stub;
  assert.equal(museOnly.canServe("sam-3.1"), false);
  const r2 = await museOnly.respond({ model: "sam-3.1", images: 1, input: "x", evidence_ids: [] });
  assert.ok(r2.status === "unavailable" && /not enabled/.test(r2.detail), JSON.stringify(r2));
  assert.equal(gatewayFromEnv({ INTEGRITY_COPILOT_LIVE: "1", MODEL_API_KEY: "k", INTEGRITY_COPILOT_MUSE: "api", INTEGRITY_COPILOT_SAM: "live" }).canServe("muse-wonder-1.0"), false);
});

test("C-019 P1: an unfinished local reply (done:false or no terminal reason) is never ok or cached", async () => {
  for (const body of [
    { model: "muse-glimmer", message: { content: "CML#a governs." }, done: false, prompt_eval_count: 5, eval_count: 5 },
    { model: "muse-glimmer", message: { content: "CML#a governs." }, done: true, prompt_eval_count: 5, eval_count: 5 },
    { model: "muse-glimmer", message: { content: "CML#a governs." }, done: true, done_reason: "unload" },
  ]) {
    const cache = new ResponseCache();
    const g = new MetaGateway({ local: true, cache, fetchImpl: (async () => chat(body)) as unknown as typeof fetch });
    const r = await g.respond({ model: "muse-glimmer", input: "x", evidence_ids: [] });
    assert.ok(r.status === "error" && r.reason === "malformed_response" && /not finished/.test(r.detail), JSON.stringify(r));
    assert.equal(cache.size, 0);
    assert.equal(g.usage[0].outcome, "error");
  }
});

test("C-021: every model request opts out of Next's persistent fetch cache", async () => {
  const inits: RequestInit[] = [];
  const spy = (async (_u: string, init: RequestInit) => {
    inits.push(init);
    return _u.startsWith("http://127.0.0.1")
      ? chat({ model: "muse-glimmer", message: { content: "CML#a governs." }, done: true, done_reason: "stop" })
      : new Response(JSON.stringify({ model: "muse-spark-1.3", output_text: "x", usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
  }) as unknown as typeof fetch;
  await new MetaGateway({ local: true, fetchImpl: spy }).respond({ model: "muse-glimmer", input: "x", evidence_ids: [] });
  await new MetaGateway({ apiKey: "k", fetchImpl: spy }).respond({ model: "muse-spark-1.3", input: "x", evidence_ids: [] });
  assert.equal(inits.length, 2);
  for (const init of inits) assert.equal(init.cache, "no-store");
});

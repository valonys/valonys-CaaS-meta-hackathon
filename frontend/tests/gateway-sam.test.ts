import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BudgetLedger, MetaGateway, ResponseCache, META_BASE_URL, extractOutputText, gatewayFromEnv } from "../lib/integrity-copilot/gateway.ts";
import { parseSamOutput, frameTimeFromVerifiedCfr } from "../lib/integrity-copilot/sam.ts";

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: (() => Response | Promise<Response>)[]) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra call");
    return next();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const okBody = { model: "muse-spark-1.3-20261020", output: [{ type: "message", content: [{ type: "output_text", text: "summary" }] }], usage: { input_tokens: 100, output_tokens: 50 } };
const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("no key: explicit unavailable, no network call", async () => {
  const f = fakeFetch([]);
  const g = new MetaGateway({ fetchImpl: f.impl });
  const r = await g.respond({ model: "muse-spark-1.3", input: "x", evidence_ids: ["e1"] });
  assert.equal(r.status, "unavailable");
  assert.equal(r.status === "unavailable" && r.reason, "not_configured");
  assert.equal(f.calls.length, 0);
  assert.equal(g.usage[0].outcome, "unavailable");
});

test("live calls are opt-in: MODEL_API_KEY alone does not enable them", () => {
  assert.equal(gatewayFromEnv({ MODEL_API_KEY: "k" }).configured, false);
  assert.equal(gatewayFromEnv({ MODEL_API_KEY: "k", INTEGRITY_COPILOT_LIVE: "1" }).configured, true);
});

test("allowlist: contributor and non-Meta models refused before any call", async () => {
  const f = fakeFetch([]);
  const g = new MetaGateway({ apiKey: "k", fetchImpl: f.impl });
  for (const model of ["muse-spark-1.3-contributor", "vendor-x-large", "other-llm-7b", "muse-spark", "llama-guard"]) {
    const r = await g.respond({ model, input: "x", evidence_ids: [] });
    assert.ok(r.status === "unavailable" && r.reason === "model_not_allowed", model);
  }
  assert.equal(f.calls.length, 0);
});

test("ok call: fixed Meta host, bearer auth, actual model id and usage logged without secrets", async () => {
  const f = fakeFetch([json(200, okBody)]);
  const g = new MetaGateway({ apiKey: "secret-key", fetchImpl: f.impl });
  const r = await g.respond({ model: "muse-spark-1.3", input: "sensitive prompt", evidence_ids: ["UT-1"] });
  assert.ok(r.status === "ok" && r.text === "summary" && r.model_id === "muse-spark-1.3-20261020");
  assert.equal(f.calls[0].url, `${META_BASE_URL}/responses`);
  assert.equal((f.calls[0].init.headers as Record<string, string>).Authorization, "Bearer secret-key");
  const logged = JSON.stringify(g.usage);
  assert.ok(!logged.includes("secret-key") && !logged.includes("sensitive prompt"));
  assert.equal(g.usage[0].model_id, "muse-spark-1.3-20261020");
  assert.deepEqual(g.usage[0].evidence_ids, ["UT-1"]);
});

test("bounded retries on 429/5xx, then explicit error (no fallback)", async () => {
  const f = fakeFetch([json(429, {}), json(503, {}), json(500, {})]);
  const g = new MetaGateway({ apiKey: "k", fetchImpl: f.impl, retries: 2, backoffMs: 1 });
  const r = await g.respond({ model: "muse-spark-1.3", input: "x", evidence_ids: [] });
  assert.ok(r.status === "error" && r.reason === "http");
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every((c) => c.url.startsWith(META_BASE_URL)));
});

test("4xx is not retried; malformed body is an error", async () => {
  const f = fakeFetch([json(401, {}), json(200, { output: [] })]);
  const g = new MetaGateway({ apiKey: "k", fetchImpl: f.impl, backoffMs: 1 });
  assert.equal((await g.respond({ model: "muse-spark-1.3", input: "x", evidence_ids: [] })).status, "error");
  const r = await g.respond({ model: "muse-spark-1.3", input: "x", evidence_ids: [] });
  assert.ok(r.status === "error" && r.reason === "malformed_response");
  assert.equal(f.calls.length, 2);
});

test("budgets fail closed and cannot be raised above defaults", async () => {
  const f = fakeFetch([json(200, okBody)]);
  const g = new MetaGateway({ apiKey: "k", fetchImpl: f.impl, maxCalls: 1 });
  assert.equal((await g.respond({ model: "muse-spark-1.3", input: "x", evidence_ids: [] })).status, "ok");
  const r = await g.respond({ model: "muse-spark-1.3", input: "x", evidence_ids: [] });
  assert.ok(r.status === "unavailable" && r.reason === "budget_exhausted");
  assert.equal(f.calls.length, 1);
  const tiny = new MetaGateway({ apiKey: "k", fetchImpl: fakeFetch([]).impl, maxUsd: 0.000001 });
  assert.equal((await tiny.respond({ model: "muse-wonder-1.0", input: "x", evidence_ids: [] })).status, "unavailable");
  const greedy = new MetaGateway({ apiKey: "k", maxUsd: 1e9, maxCalls: 1e9 });
  assert.equal(greedy.ledger.maxUsd, 25);
  assert.equal(greedy.ledger.maxCalls, 400);
});

test("timeout becomes an explicit error", async () => {
  const hang = (async (_u: string, init: RequestInit) =>
    new Promise((_r, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as unknown as typeof fetch;
  const g = new MetaGateway({ apiKey: "k", fetchImpl: hang, timeoutMs: 5, retries: 0 });
  const r = await g.respond({ model: "muse-spark-1.3", input: "x", evidence_ids: [] });
  assert.ok(r.status === "error" && r.reason === "timeout");
});

test("extractOutputText prefers output_text, else joins output_text parts", () => {
  assert.equal(extractOutputText({ output_text: "a" }), "a");
  assert.equal(extractOutputText(okBody), "summary");
  assert.equal(extractOutputText({}), null);
});

// Doc-derived golden fixture (dev.meta.ai/docs/sam/reading-segmentation grammar), NOT a recorded API response.
test("SAM parser: documented grammar, skipped frames, zero matches, confidence", () => {
  const text = [
    "<0f><|box;x1=10;y1=20;x2=60;y2=57;w=640;h=480;c=0.91|><|mask;x=0;y=0;c=0.88;data=37,51,~AbC;dE|>,<|box;x1=100;y1=100;x2=120;y2=130;w=640;h=480|><|mask;x=0;y=0;data=30,20,!zz|>",
    "<3f>",
    "<7f><|box;x1=11;y1=21;x2=61;y2=58;w=640;h=480;id=4|><|mask;x=0;y=0;data=37,50,~Q|>",
  ].join("\n");
  const r = parseSamOutput(text);
  assert.equal(r.status, "ok");
  if (r.status !== "ok") return;
  assert.deepEqual(r.frames.map((f) => f.frame_index), [0, 3, 7]);
  assert.equal(r.frames[0].records.length, 2);
  assert.equal(r.frames[0].records[0].box.c, 0.91);
  assert.equal(r.frames[0].records[0].mask.rows, 37);
  assert.equal(r.frames[0].records[0].mask.cols, 51);
  assert.equal(r.frames[0].records[0].mask.encoding, "lossless");
  assert.equal(r.frames[0].records[0].mask.payload, "AbC;dE");
  assert.equal(r.frames[0].records[1].mask.encoding, "one_bit");
  assert.equal(r.frames[1].records.length, 0);
  assert.equal(r.frames[2].records[0].box.extra.id, "4");
});

test("SAM parser rejects malformed output instead of guessing", () => {
  assert.equal(parseSamOutput("<|box;x1=1|>").status, "malformed");
  assert.equal(parseSamOutput("<0f><|box;x1=1;y1=1;x2=2;y2=2;w=10;h=10|>").status, "malformed");
  assert.equal(parseSamOutput("<0f><|box;x1=5;y1=1;x2=2;y2=2;w=10;h=10|><|mask;data=1,1,~a|>").status, "malformed");
  assert.equal(parseSamOutput("<0f><|box;x1=1;y1=1;x2=2;y2=2;w=10;h=10;c=1.5|><|mask;data=1,1,~a|>").status, "malformed");
});

test("frame time only from verified constant frame rate", () => {
  assert.deepEqual(frameTimeFromVerifiedCfr(50, 25, "1/25"), { seconds: 2, derivation: "verified_cfr", timebase: "1/25" });
  assert.throws(() => frameTimeFromVerifiedCfr(-1, 25, "1/25"));
});

// ---------- C-004 review regressions (review findings 1, 4, 5) ----------

test("C-004 #1: returned contributor / foreign model is an error, reservation kept", async () => {
  for (const model of ["muse-spark-1.3-contributor", "muse-spark-1.3-contributor-20261020", "muse-wonder-1.0", "llama-4", "muse-spark-1.30"]) {
    const g = new MetaGateway({ apiKey: "k", fetchImpl: fakeFetch([json(200, { ...okBody, model })]).impl });
    const r = await g.respond({ model: "muse-spark-1.3", input: "x", evidence_ids: [] });
    assert.ok(r.status === "error" && r.reason === "malformed_response", model);
    assert.ok(g.spent.estimated_usd > 0, `${model}: reservation must be retained`);
  }
  const exact = new MetaGateway({ apiKey: "k", fetchImpl: fakeFetch([json(200, { ...okBody, model: "muse-spark-1.3" })]).impl });
  assert.equal((await exact.respond({ model: "muse-spark-1.3", input: "x", evidence_ids: [] })).status, "ok");
});

test("C-004 #1: non-numeric / negative / fractional usage is an error and spend never becomes NaN", async () => {
  for (const usage of [{ input_tokens: "100", output_tokens: 5 }, { input_tokens: -1, output_tokens: 5 }, { input_tokens: 1.5 }, { output_tokens: Infinity }, { reasoning_tokens: null }, "lots", [1]]) {
    const g = new MetaGateway({ apiKey: "k", fetchImpl: fakeFetch([json(200, { ...okBody, usage }), json(200, okBody)]).impl, maxUsd: 0.01, maxOutputTokens: 2048 }); // worst case must fit the tiny budget
    const r = await g.respond({ model: "muse-spark-1.3", input: "x", evidence_ids: [] });
    assert.ok(r.status === "error" && r.reason === "malformed_response", JSON.stringify(usage));
    assert.ok(Number.isFinite(g.spent.estimated_usd) && g.spent.estimated_usd > 0, JSON.stringify(usage));
  }
  // Absent usage: accepted, worst-case reservation kept (never reconciled to zero).
  const g = new MetaGateway({ apiKey: "k", fetchImpl: fakeFetch([json(200, { model: "muse-spark-1.3", output_text: "s" })]).impl });
  assert.equal((await g.respond({ model: "muse-spark-1.3", input: "x", evidence_ids: [], max_output_tokens: 100 })).status, "ok");
  assert.ok(g.spent.estimated_usd >= (100 * 4.25) / 1e6);
});

test("C-004 #5: a stalled response body times out", async () => {
  const stalled = (async (_u: string, init: RequestInit) => {
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"model":')); init.signal?.addEventListener("abort", () => c.error(Object.assign(new Error("aborted"), { name: "AbortError" }))); } });
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const g = new MetaGateway({ apiKey: "k", fetchImpl: stalled, timeoutMs: 20, retries: 0 });
  const r = await g.respond({ model: "muse-spark-1.3", input: "x", evidence_ids: [] });
  assert.ok(r.status === "error" && r.reason === "timeout", JSON.stringify(r));
});

test("C-004 #5: a shared ledger is a cross-request ceiling; per-request gateways cannot reset it", async () => {
  const ledger = new BudgetLedger({ maxCalls: 2 });
  const env = { MODEL_API_KEY: "k", INTEGRITY_COPILOT_LIVE: "1", INTEGRITY_COPILOT_MUSE: "api" };
  const results: string[] = [];
  for (let i = 0; i < 3; i++) {
    const g = gatewayFromEnv(env, ledger);
    (g as unknown as { cfg: { fetchImpl: typeof fetch } }).cfg.fetchImpl = fakeFetch([json(200, okBody)]).impl;
    results.push((await g.respond({ model: "muse-spark-1.3", input: "x", evidence_ids: [] })).status);
  }
  assert.deepEqual(results, ["ok", "ok", "unavailable"]);
  assert.equal(ledger.spent.calls, 2);
  assert.equal(new BudgetLedger({ maxUsd: NaN }).maxUsd, 25);
});

test("C-004 #4: SAM parser consumes the whole line and validates geometry and payload", () => {
  for (const bad of [
    "<0f>garbage",
    "<0f><|box;x1=1;y1=1;x2=2;y2=2;w=10;h=10|><|mask;x=0;y=0;data=1,1,~a|> trailing",
    "<0f>junk<|box;x1=1;y1=1;x2=2;y2=2;w=10;h=10|><|mask;x=0;y=0;data=1,1,~a|>",
    "<0f><|box;x1=-1;y1=1;x2=2;y2=2;w=10;h=10|><|mask;x=0;y=0;data=1,1,~a|>",
    "<0f><|box;x1=0;y1=0;x2=0;y2=0;w=0;h=10|><|mask;x=0;y=0;data=1,1,~a|>",
    "<0f><|box;x1=1;y1=1;x2=2;y2=2;w=10;h=10|><|mask;x=0;y=0;data=0,1,~a|>",
    "<0f><|box;x1=1;y1=1;x2=2;y2=2;w=10;h=10|><|mask;x=0;y=0;data=1,1,~|>",
    "<0f><|box;x1=1;y1=1;x2=2;y2=2;w=10;h=10|><|mask;x=0;y=0;data=1,1,?abc|>",
    "<0f><|box;x1=1;y1=1;x2=2;y2=2;w=10;h=10|><|mask;x=0;y=0;data=1,1,~a b|>",
  ]) {
    assert.equal(parseSamOutput(bad).status, "malformed", bad);
  }
  assert.equal(parseSamOutput("<0f>").status, "ok"); // zero matches stays valid
  assert.equal(parseSamOutput("<0f>  ").status, "ok");
});

// Live probe 2026-10-30: at the API default, muse-spark-1.3 spent 510/512 output tokens reasoning
// and returned status "incomplete" with only a reasoning item. The API's store default is true.
test("request body: store:false always, low reasoning for Muse, none for SAM", async () => {
  const f = fakeFetch([json(200, okBody), json(200, { ...okBody, model: "muse-spark-1.3" }), json(200, { ...okBody, model: "sam-3.1" })]);
  const g = new MetaGateway({ apiKey: "k", fetchImpl: f.impl });
  await g.respond({ model: "muse-spark-1.3", input: "x", evidence_ids: [] });
  await g.respond({ model: "muse-spark-1.3", input: "x", evidence_ids: [], reasoning_effort: "high" });
  await g.respond({ model: "sam-3.1", input: "x", evidence_ids: [] });
  const bodies = f.calls.map((c) => JSON.parse(String(c.init.body)));
  assert.ok(bodies.every((b) => b.store === false));
  assert.deepEqual(bodies[0].reasoning, { effort: "low" });
  assert.deepEqual(bodies[1].reasoning, { effort: "high" });
  assert.equal(bodies[2].reasoning, undefined);
});

test("incomplete response (token cap spent on reasoning) is an explicit error, worst case kept", async () => {
  const incomplete = {
    model: "muse-spark-1.3",
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    output: [{ type: "reasoning", summary: [], status: "incomplete" }],
    usage: { input_tokens: 20, input_tokens_details: { cached_tokens: 0 }, output_tokens: 512, output_tokens_details: { reasoning_tokens: 510 }, total_tokens: 532 },
  };
  const g = new MetaGateway({ apiKey: "k", fetchImpl: fakeFetch([json(200, incomplete)]).impl });
  const r = await g.respond({ model: "muse-spark-1.3", input: "x", evidence_ids: [] });
  assert.equal(r.status, "error");
  assert.equal(r.status === "error" && r.reason, "incomplete");
  assert.match(r.status === "error" ? r.detail : "", /max_output_tokens/);
  assert.equal(g.usage[0].estimated_usd > 0, true);
  assert.equal(g.usage[0].usage?.output_tokens, 512);
});

test("provider reporting store:true is refused", async () => {
  const g = new MetaGateway({ apiKey: "k", fetchImpl: fakeFetch([json(200, { ...okBody, store: true })]).impl });
  const r = await g.respond({ model: "muse-spark-1.3", input: "x", evidence_ids: [] });
  assert.equal(r.status === "error" && r.reason, "malformed_response");
});

test("C-012 cache: a repeat request is served without a call, a slot or spend; errors are never cached", async () => {
  const cache = new ResponseCache();
  const f = fakeFetch([json(500, {}), json(200, okBody)]);
  const g = new MetaGateway({ apiKey: "k", fetchImpl: f.impl, retries: 0, cache, maxCalls: 2 });
  const req = { model: "muse-spark-1.3", input: "same", evidence_ids: [] };
  assert.equal((await g.respond(req)).status, "error"); // HTTP 500: not cached
  assert.equal(cache.size, 0);
  assert.equal((await g.respond(req)).status, "ok"); // second (last) call slot
  assert.equal(cache.size, 1);
  const before = g.spent;
  const hit = await g.respond(req); // budget now exhausted (2/2 calls), but a hit needs none
  assert.equal(hit.status, "ok");
  assert.equal(f.calls.length, 2, "cache hit must not reach the network");
  assert.deepEqual(g.spent, before, "cache hit reserves nothing");
  assert.equal(g.usage.at(-1)?.detail, "cache_hit");
  assert.equal(g.usage.at(-1)?.estimated_usd, 0);
  // A different input, effort or cap is a different key.
  const miss = await g.respond({ ...req, reasoning_effort: "high" });
  assert.equal(miss.status, "unavailable");
});

test("C-012 cache: bounded size evicts the oldest entry", () => {
  const c = new ResponseCache(2);
  c.set("a", { text: "A", model_id: "m" });
  c.set("b", { text: "B", model_id: "m" });
  c.set("c", { text: "C", model_id: "m" });
  assert.equal(c.size, 2);
  assert.equal(c.get("a"), undefined);
  assert.equal(c.get("c")?.text, "C");
});

// Real sam-3.1 output (2026-10-30) for public/evidence/synthetic-pipe.png, a generated 320x160 test image:
// grey pipe band with an orange patch at x 140..199, y 60..94; prompt "orange patch".
test("SAM live golden: object-id prefix parsed, box matches the drawn patch, box-sized mask", () => {
  const live = readFileSync(new URL("../lib/integrity-copilot/fixtures/sam-live-synthetic-pipe-2026-10-30.txt", import.meta.url), "utf8");
  const r = parseSamOutput(live);
  assert.equal(r.status, "ok", JSON.stringify(r));
  if (r.status !== "ok") return;
  assert.equal(r.frames.length, 1);
  const [{ box, mask }] = r.frames[0].records;
  assert.deepEqual([box.object_id, box.x1, box.y1, box.x2, box.y2, box.w, box.h], [0, 140, 60, 199, 94, 320, 160]);
  assert.deepEqual([mask.rows, mask.cols, mask.encoding], [box.y2 - box.y1 + 1, box.x2 - box.x1 + 1, "lossless"]);
});

test("SAM: an object id may precede only a box", () => {
  const box = "<|box;x1=1;y1=1;x2=2;y2=2;w=4;h=4|>";
  const mask = "<|mask;x=0;y=0;data=2,2,~abc|>";
  assert.equal(parseSamOutput(`<0f>7${box}${mask}`).status, "ok");
  assert.equal(parseSamOutput(`<0f>${box}${mask}`).status, "ok"); // id optional (documented form)
  assert.equal(parseSamOutput(`<0f>${box}3${mask}`).status, "malformed");
  assert.equal(parseSamOutput(`<0f>x${box}${mask}`).status, "malformed");
});

// C-014 P1s: SAM cost must not trust the caller's image hint, and images_processed is validated.
const samOk = (usage: unknown) => json(200, { model: "sam-3.1", output: [{ type: "message", content: [{ type: "output_text", text: "<0f>" }] }], usage });
const samReq = (images?: number) => ({
  model: "sam-3.1",
  evidence_ids: ["img"],
  ...(images === undefined ? {} : { images }),
  input: [{ role: "user", content: [{ type: "input_text", text: "patch" }, { type: "input_image", image_url: "data:image/png;base64,AA==" }] }],
});
test("C-014 SAM cost: images counted from the request, images_processed validated, overage charged", async () => {
  const zero = { input_tokens: 0, output_tokens: 0 };
  const g1 = new MetaGateway({ apiKey: "k", fetchImpl: fakeFetch([samOk({ ...zero, images_processed: 1 })]).impl });
  assert.equal((await g1.respond(samReq(1))).status, "ok");
  assert.equal(g1.usage[0].estimated_usd, 0.0025);

  const g2 = new MetaGateway({ apiKey: "k", fetchImpl: fakeFetch([samOk({ ...zero, images_processed: 1 })]).impl });
  assert.equal((await g2.respond(samReq())).status, "ok"); // no hint: still billed for the input_image sent
  assert.equal(g2.usage[0].estimated_usd, 0.0025);
  assert.equal(g2.spent.estimated_usd, 0.0025);

  const g3 = new MetaGateway({ apiKey: "k", fetchImpl: fakeFetch([samOk({ ...zero, images_processed: 2 })]).impl });
  const r3 = await g3.respond(samReq(1));
  assert.ok(r3.status === "error" && r3.reason === "malformed_response" && /processed 2 images but 1/.test(r3.detail));
  assert.ok(Math.abs(g3.spent.estimated_usd - 0.005) < 1e-12, `overage must be charged: ${g3.spent.estimated_usd}`);

  for (const bad of ["1", 1.5, -1, 2 ** 53]) {
    const g = new MetaGateway({ apiKey: "k", fetchImpl: fakeFetch([samOk({ ...zero, images_processed: bad })]).impl });
    const r = await g.respond(samReq(1));
    assert.ok(r.status === "error" && r.reason === "malformed_response", String(bad));
  }
});

test("C-014 SAM: object ids must be safe integers", () => {
  const rec = "<|box;x1=1;y1=1;x2=2;y2=2;w=4;h=4|><|mask;x=0;y=0;data=2,2,~abc|>";
  assert.equal(parseSamOutput(`<0f>9007199254740993${rec}`).status, "malformed");
  assert.equal(parseSamOutput(`<0f>${"9".repeat(400)}${rec}`).status, "malformed");
  assert.equal(parseSamOutput(`<0f>9007199254740991${rec}`).status, "ok");
});

test("C-016/C-017 P2: images_processed required for image requests; overage visible in the usage log", async () => {
  const zero = { input_tokens: 0, output_tokens: 0 };
  const g1 = new MetaGateway({ apiKey: "k", fetchImpl: fakeFetch([samOk(zero)]).impl });
  const r1 = await g1.respond(samReq(1));
  assert.ok(r1.status === "error" && r1.reason === "malformed_response" && /must be present/.test(r1.detail));
  const g2 = new MetaGateway({ apiKey: "k", fetchImpl: fakeFetch([samOk({ ...zero, images_processed: 2 })]).impl });
  await g2.respond(samReq(1));
  assert.ok(Math.abs(g2.usage[0].estimated_usd - 0.005) < 1e-12, `log must show the charged overage: ${g2.usage[0].estimated_usd}`);
  assert.ok(Math.abs(g2.spent.estimated_usd - 0.005) < 1e-12);
});

test("C-016/C-017 P2: inclusive box endpoints must stay inside the frame", () => {
  const mask = "<|mask;x=0;y=0;data=1,1,~abc|>";
  assert.equal(parseSamOutput(`<0f>0<|box;x1=319;y1=159;x2=320;y2=160;w=320;h=160|>${mask}`).status, "malformed");
  assert.equal(parseSamOutput(`<0f>0<|box;x1=319;y1=159;x2=319;y2=159;w=320;h=160|>${mask}`).status, "ok");
});

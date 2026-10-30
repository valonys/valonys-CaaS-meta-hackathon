import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MetaGateway } from "../lib/integrity-copilot/gateway.ts";
import { numericContent, prepareModelInput, restoreAliases } from "../lib/integrity-copilot/faithfulness.ts";
import { runReplay, type CircuitFixture, type WorkflowResult } from "../lib/integrity-copilot/workflow.ts";

const fx = JSON.parse(readFileSync(new URL("../lib/integrity-copilot/fixtures/synthetic-circuit.json", import.meta.url), "utf8")) as CircuitFixture;
const fixture = (name: string) => readFileSync(new URL(`../lib/integrity-copilot/fixtures/${name}`, import.meta.url), "utf8");
// Real muse-spark-1.3 replies, synthetic data only:
const LIVE_NUMERIC = fixture("live-summary-2026-10-30.txt"); // C-009: restates values
const LIVE_RAW_IDS = fixture("live-summary-qualitative-2026-10-30.txt"); // C-011: qualitative, raw digit-bearing ids
const LIVE_ALIASED = fixture("live-summary-aliased-2026-10-30.txt"); // C-013: qualitative, digit-free aliases
const NOW = () => new Date("2026-10-29T09:00:00Z");

// Golden live response shape (C-009): completed, reasoning item + message item, store:false.
const liveResponse = (text: string) => ({
  object: "response",
  status: "completed",
  model: "muse-spark-1.3",
  store: false,
  output: [
    { type: "reasoning", summary: [], status: "completed" },
    { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] },
  ],
  usage: { input_tokens: 647, input_tokens_details: { cached_tokens: 0 }, output_tokens: 3026, output_tokens_details: { reasoning_tokens: 2500 }, total_tokens: 3673 },
});

async function replay(text: string): Promise<{ r: WorkflowResult; request: string }> {
  let request = "";
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    request = JSON.parse(String(init.body)).input[1].content;
    return new Response(JSON.stringify(liveResponse(text)), { status: 200 });
  }) as unknown as typeof fetch;
  return { r: await runReplay(fx, new MetaGateway({ apiKey: "k", fetchImpl, narrativeModel: "muse-spark-1.3" }), NOW), request };
}
const withheld = (r: WorkflowResult, label: string) => {
  assert.ok(r.meta_summary.status === "error" && r.meta_summary.reason === "unfaithful", `${label} -> ${JSON.stringify(r.meta_summary)}`);
  assert.ok(!("text" in r.meta_summary), `${label}: text must not be exposed`);
};
const OK_EN = "CML#a governs on its short-term rate under POL#b; the next inspection per PROC#e follows the remaining life.";

test("request to Meta carries no number character; identifiers are digit-free aliases", async () => {
  const { request } = await replay("ok");
  assert.equal(/\p{N}/u.test(request), false, request);
  for (const leak of ["CML-03", "UT-03-2016", "CAL-2024", "CAL-2020", "2032", "0.1875"]) assert.ok(!request.includes(leak), `leaked ${leak}`);
  assert.match(request, /CML#a/);
  assert.match(request, /\[value\]/);
});

test("the real live aliased summary is shown, with real identifiers restored", async () => {
  const { r } = await replay(LIVE_ALIASED);
  assert.equal(r.meta_summary.status, "ok", JSON.stringify(r.meta_summary));
  const text = r.meta_summary.status === "ok" ? r.meta_summary.text : "";
  assert.match(text, /CML-03 shows governing short-term rate/);
  assert.ok(!/#[a-z]+\b/.test(text), "no alias may survive restoration");
});

test("earlier live replies are withheld: restated values (C-009) and raw digit-bearing ids (C-011)", async () => {
  withheld((await replay(LIVE_NUMERIC)).r, "C-009 numeric");
  withheld((await replay(LIVE_RAW_IDS)).r, "C-011 raw ids");
});

// Every C-010 class and every C-011 review input, at workflow level.
const ATTACKS = [
  "remaining life １８ years", "remaining life ١٨ years", "remaining life -16 years", "remaining life −16 years",
  "remaining life 1e3 years", "remaining life 3/16 years", "remaining life eighteen years", "vida remanescente de dezoito anos",
  "governing corrosion rate 16%", "latest thickness 9,000 mm", "remaining life 6 years", "inspection due 2024-01-01", "rate ½ mm/y",
  // C-011 #1: identifier digits as values, raw or as alias
  "The remaining life is CML-03 years", "The inspection year is CAL-2024", "The remaining life is CML#a years", "vida de CML#a anos",
  "CML#zz governs", // unknown alias
  // C-011 #2: hidden characters splitting number words
  "eigh​teen years", "eigh­teen years", "dezo⁠ito anos", "eigh͏teen years", "eighteen years",
  // C-011 #3: Portuguese vocabulary, accents and case
  "A vida remanescente é uma dúzia de anos", "A vida remanescente é um bilhão de anos", "Três anos", "TRINTA anos", "duzentos milímetros",
];
test("numeric guard: every C-010 and C-011 attack is withheld", async () => {
  for (const claim of ATTACKS) withheld((await replay(`${OK_EN} ${claim}.`)).r, claim);
});

test("numeric guard: unit cases", () => {
  const { masked, aliases } = prepareModelInput('{"f":"CML-03 rate 0.1875 under POL-SYNTH-RATE-01, CML-03 again, UT-03-2016 on 2032-01-01T00:00:00.000Z, not zero-filled"}');
  assert.equal(masked, '{"f":"CML#a rate [value] under POL#b, CML#a again, UT#c on [value], not zero-filled"}');
  assert.deepEqual([...aliases], [["CML#a", "CML-03"], ["POL#b", "POL-SYNTH-RATE-01"], ["UT#c", "UT-03-2016"]]);
  assert.deepEqual(numericContent("CML#a and UT#c, not zero-filled, double-check por meio de UT; uma inspeção", aliases), []);
  assert.equal(restoreAliases("CML#a per UT#c", aliases), "CML-03 per UT-03-2016");
  assert.deepEqual(numericContent("não preenchido com zeros", aliases), []);
  assert.deepEqual(numericContent("zero readings", aliases), ["zero"]); // the bare word is still a count
  assert.deepEqual(numericContent("", aliases), []);
});

// C-013 review P1s (exact inputs), at workflow level.
test("alias P1s: stated-as-value aliases, forged aliases and placeholders are withheld", async () => {
  const { request } = await replay("ok");
  const cal2024 = [...request.matchAll(/\bCAL#[a-z]+\b/g)].map((m) => m[0]);
  assert.ok(cal2024.length >= 1, "fixture has calibration aliases");
  for (const claim of [
    "The remaining life is CML#a.",
    ...cal2024.map((a) => `The inspection year is ${a}.`),
    "CML#A governs the short-term rate.",
    "CML#ZZ governs the short-term rate.",
    "CML[value] governs the short-term rate.",
    "A vida remanescente é CML#a.",
  ]) withheld((await replay(`${OK_EN} ${claim}`)).r, claim);
  // An alias used as a real identifier (not as a value) is still fine.
  const ok = (await replay(`${OK_EN} The remaining life of CML#a is governed by the short-term rate.`)).r;
  assert.equal(ok.meta_summary.status, "ok", JSON.stringify(ok.meta_summary));
});

test("compact identifiers (CML03, CML04, Rev2) get distinct digit-free aliases; no [value] fused to a name", async () => {
  const compact = JSON.parse(JSON.stringify(fx).replaceAll("CML-03", "CML03").replaceAll("CML-04", "CML04")) as CircuitFixture;
  let request = "";
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    request = JSON.parse(String(init.body)).input[1].content;
    return new Response(JSON.stringify(liveResponse("CML#a governs on its short-term rate.")), { status: 200 });
  }) as unknown as typeof fetch;
  await runReplay(compact, new MetaGateway({ apiKey: "k", fetchImpl, narrativeModel: "muse-spark-1.3" }), NOW);
  assert.equal(/\p{N}/u.test(request), false);
  assert.ok(!/\p{L}\[value\]|\[value\]\p{L}/u.test(request), `identity lost: ${request.match(/\S*\[value\]\S*/)?.[0]}`);
  const { aliases } = prepareModelInput("CML03 CML04 Rev2 A1B CML03");
  assert.deepEqual([...aliases.values()], ["CML03", "CML04", "Rev2", "A1B"]);
  assert.equal(new Set(aliases.keys()).size, 4, "distinct ids must get distinct aliases");
});

test("C-015 P1: alias + hyphenated unit (ASCII and non-breaking hyphen) is withheld", async () => {
  for (const claim of ["A CML#a-year remaining life applies.", "A CML#a‑year remaining life applies.", "Uma vida de CML#a–anos."]) {
    withheld((await replay(`${OK_EN} ${claim}`)).r, claim);
  }
});

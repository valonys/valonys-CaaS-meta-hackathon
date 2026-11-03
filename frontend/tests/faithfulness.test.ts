import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MetaGateway } from "../lib/integrity-copilot/gateway.ts";
import { numericContent, PERCENT_CODE_PHRASE, prepareModelInput, restoreAliases } from "../lib/integrity-copilot/faithfulness.ts";
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

test("C-037: %-bearing technique codes never reach the model, not even as an alias; free-standing % is still withheld", () => {
  const { masked, aliases } = prepareModelInput("next: UTM-01-100% per PROC-SYN-UT-01 (same procedure); VIE-01-100% visual");
  assert.ok(!masked.includes("%"), masked);
  assert.equal(/\p{N}/u.test(masked), false, masked);
  assert.ok(masked.includes(`next: ${PERCENT_CODE_PHRASE} per PROC#a`), masked);
  assert.equal([...aliases.values()].some((id) => id.includes("%")), false, "no alias restores to a %");
  // Realistic narratives that the C-036 rule withheld are now accepted, and restore with no %.
  for (const s of [
    `The corrosion rate is high at this point. Re-inspect using ${PERCENT_CODE_PHRASE} per PROC#a.`,
    `Remaining life is short; re-inspect with ${PERCENT_CODE_PHRASE}.`,
    `A taxa de corrosão é elevada. Reinspecionar usando ${PERCENT_CODE_PHRASE} conforme PROC#a.`,
  ]) {
    assert.deepEqual(numericContent(s, aliases), [], s);
    assert.ok(!restoreAliases(s, aliases).includes("%"), s);
  }
  // Any attempt to name the code is an unknown alias and withholds.
  assert.ok(numericContent("Coverage is UTM#b.", aliases).length > 0);
  assert.ok(numericContent("coverage was 100%", aliases).includes("100%"));
  assert.ok(numericContent("coverage was complete %", aliases).includes("%"));
});

test("C-037 review P1: Unicode percent signs (％ ﹪ ٪) and per-mille are percent too, end to end", () => {
  for (const sign of ["%", "％", "﹪", "٪", "‰", "‱"]) {
    const { masked, aliases } = prepareModelInput(`next: UTM-01-100${sign} per PROC-SYN-UT-01; coverage 100${sign}; coverage ${sign}`);
    assert.equal(new RegExp(`[%％﹪٪‰‱\\p{N}]`, "u").test(masked), false, masked);
    assert.ok(masked.includes(PERCENT_CODE_PHRASE), masked);
    assert.equal([...aliases.values()].some((id) => /[%％﹪٪‰‱]/u.test(id)), false, sign);
    // The review's exact reply shape: an echoed sign is numeric content and withholds.
    assert.ok(numericContent(`It achieved UTM#a${sign}.`, aliases).length > 0, sign);
    assert.ok(numericContent(`It achieved full coverage ${sign}.`, aliases).includes(sign), sign);
  }
  // A caller-built map with a Unicode-percent code is still method-only.
  const map = new Map([["UTM#a", "UTM-01-100％"]]);
  assert.ok(numericContent("Coverage is UTM#a.", map).length > 0);
  assert.deepEqual(numericContent("Re-inspect using UTM#a.", map), []);
});

test("C-038 review P1: allowlist, not a sign list: ؉ ؊ and a tag percent sign cannot reach or leave the model", () => {
  for (const sign of ["\u0609", "\u060A", "\u2030", "\u00B0", "\u066A", "\u2031"]) {
    const { masked, aliases } = prepareModelInput(`Use UTM-01-100${sign} per PROC-SYN-UT-01; coverage 100${sign}`);
    assert.equal(masked.includes(sign), false, `${sign} in ${masked}`);
    assert.ok(masked.includes(PERCENT_CODE_PHRASE), masked);
    assert.equal([...aliases.values()].some((id) => id.includes(sign)), false, sign);
    assert.ok(numericContent(`It achieved UTM#a${sign}.`, aliases).length > 0, sign);
    assert.ok(numericContent(`Full coverage ${sign}.`, aliases).length > 0, sign);
  }
  // U+E0025 TAG PERCENT SIGN: a code followed by a hidden character is a signed code too (C-039 review),
  // so no alias can restore its digits, and no hidden character reaches the model.
  const { masked, aliases } = prepareModelInput("Use UTM-01-100\u{E0025} per PROC-SYN-UT-01; also UTM-02-50\u200B");
  assert.equal(/[\p{Cf}\p{Cn}\p{Default_Ignorable_Code_Point}]/u.test(masked), false, JSON.stringify(masked));
  assert.equal(masked, `Use ${PERCENT_CODE_PHRASE} per PROC#a; also ${PERCENT_CODE_PHRASE}`);
  assert.equal([...aliases.values()].some((id) => id.startsWith("UTM")), false);
  // The review's exact valid-method reply cannot restore the code's digits: UTM#a is not issued.
  assert.ok(numericContent("Re-inspect using UTM#a per PROC#b.", aliases).length > 0);
  assert.ok(numericContent("It achieved UTM#a\u{E0025}.", aliases).length > 0);
  // Ordinary typographic prose stays acceptable.
  assert.deepEqual(numericContent("The governing rate — short-term; “re-inspect” soon… Próxima inspeção «em breve».", aliases), []);
});

test("C-040 review P1: a combining mark or non-ASCII letter glued to a code makes it a signed code", () => {
  for (const tail of ["\u0301", "\u212B", "\u2135", "é", "\u00C5", "\u2102", "\u212A", "\uFF21", "\uFB00"]) {
    const { masked, aliases } = prepareModelInput(`Use UTM-01-100${tail} per PROC-SYN-UT-01`);
    assert.equal(masked, `Use ${PERCENT_CODE_PHRASE} per PROC#a`, JSON.stringify(masked));
    assert.equal([...aliases.values()].some((id) => id.startsWith("UTM")), false, tail);
    assert.ok(numericContent(`It achieved UTM#a${tail}.`, aliases).length > 0, tail);
  }
  // Compatibility digits and signs still never reach the model without normalization (C-041 review).
  const compat = prepareModelInput("Use UTM-\uFF10\uFF11 per PROC-SYN-UT-01; coverage \uFF11\uFF10\uFF10\uFF05; \u00B2 \u2167 \u00BD");
  assert.equal(new RegExp(`[\\p{N}%\uFF05]`, "u").test(compat.masked), false, compat.masked);
  // Ordinary Portuguese prose next to a code (separated by a space) is unaffected.
  const { masked } = prepareModelInput("Ponto CML-03 é crítico");
  assert.equal(masked, "Ponto CML#a é crítico");
});

test("C-042 review P1: documented EN/PT link verbs state a value, so an alias after them is withheld", () => {
  const { aliases } = prepareModelInput("CML-03 and PROC-SYN-UT-01");
  for (const bad of [
    "The remaining life corresponds to CML#a.", "A vida remanescente corresponde a CML#a.",
    "The remaining life amounts to CML#a.", "The rate stands at CML#a.", "The thickness reaches the CML#a.",
    "The interval equals the CML#a.", "O intervalo equivale a CML#a.", "A espessura atinge CML#a.",
    "A taxa fica em CML#a.", "O prazo será CML#a.",
    // C-043 review: no length limit within the clause.
    "The remaining life under the conservative engineering assessment corresponds to CML#a.",
    "A vida remanescente segundo a avaliação conservadora de engenharia corresponde a CML#a.",
  ]) {
    assert.ok(numericContent(bad, aliases).some((f) => f.startsWith("identifier used as a value")), bad);
  }
  // Ordinary references to a point stay acceptable.
  for (const good of [
    "The remaining life of CML#a is short.", "The governing rate at CML#a is short-term based.",
    "A vida remanescente em CML#a é curta.", "Re-inspect CML#a per PROC#b.",
    "The remaining life to minimum thickness is calculated from the remaining thickness divided by the governing rate.",
  ]) {
    assert.deepEqual(numericContent(good, aliases), [], good);
  }
});

test("a withheld narrative is evicted from the response cache, so a retry asks the model again", async () => {
  const { ResponseCache } = await import("../lib/integrity-copilot/gateway.ts");
  const cache = new ResponseCache();
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response(JSON.stringify({ model: "muse-glimmer:latest", message: { content: "CML#a has 18 years left." }, done: true, done_reason: "stop", prompt_eval_count: 5, eval_count: 5 }), { status: 200 });
  }) as unknown as typeof fetch;
  const gw = () => new MetaGateway({ local: true, fetchImpl, cache });
  const r1 = await runReplay(fx, gw(), NOW);
  assert.ok(r1.meta_summary.status === "error" && r1.meta_summary.reason === "unfaithful");
  assert.equal(cache.size, 0, "withheld text must not stay cached");
  await runReplay(fx, gw(), NOW);
  assert.equal(calls, 2, "the retry reached the model again");
});

test("C-032 P1: %-bearing aliases only as a method; leftover % never reaches the model (the review's exact shapes)", () => {
  // Defence in depth for a caller-built map; prepareModelInput itself no longer issues such an alias (C-037).
  const { masked } = prepareModelInput("Use UTM-01-100% per PROC-SYN-UT-01; coverage 100%; coverage %");
  assert.equal(/[%‰\p{N}]/u.test(masked), false, masked);
  const aliases = new Map([["UTM#a", "UTM-01-100%"], ["PROC#b", "PROC-SYN-UT-01"]]);
  for (const bad of [
    "Coverage is UTM#a.", "The percentage equals UTM#a.", "It achieved UTM#a.", "A cobertura é UTM#a.",
    "Coverage is method UTM#a.", "Coverage is technique UTM#a.", "Coverage is inspection UTM#a.", "A cobertura é método UTM#a.",
    "Coverage equals the fully documented inspection method UTM#a.",
    "The percentage equals the fully documented inspection method UTM#a.",
    "A cobertura é o método de inspeção totalmente documentado UTM#a.",
    "Coverage equals e.g. inspection method UTM#a.", "Coverage equals i.e. inspection method UTM#a.",
    "The percentage is e.g. re-inspection technique UTM#a.", "A cobertura é p.ex. método de inspeção UTM#a.",
    "A percentagem é e.g. técnica UTM#a.",
  ]) {
    assert.ok(numericContent(bad, aliases).length > 0, bad);
  }
  for (const good of ["Use UTM#a per PROC#b.", "the next inspection is UTM#a per PROC#b rev A", "Re-inspect using UTM#a.", "Próxima inspeção por UTM#a conforme PROC#b."]) {
    assert.deepEqual(numericContent(good, aliases), [], good);
  }
  assert.equal(restoreAliases("Use UTM#a per PROC#b.", aliases), "Use UTM-01-100% per PROC-SYN-UT-01.");
});

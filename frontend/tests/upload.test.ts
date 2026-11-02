import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCsv } from "../lib/integrity-copilot/csv.ts";
import { UploadStore, validateUpload } from "../lib/integrity-copilot/uploads.ts";
import { workbookToLines, type Portfolio } from "../lib/integrity-copilot/workbook.ts";
import { rankNextSpots } from "../lib/integrity-copilot/nextspots.ts";
import { runReplay } from "../lib/integrity-copilot/workflow.ts";
import { MetaGateway } from "../lib/integrity-copilot/gateway.ts";

const load = (): Portfolio => JSON.parse(readFileSync(new URL("../lib/integrity-copilot/fixtures/synthetic-portfolio.json", import.meta.url), "utf8"));
const DEMO = readFileSync(new URL("../public/templates/example-ut-campaign-line-A.csv", import.meta.url), "utf8");
const A = "SYN/FPSOT/GAS/COMP/IPN-_NG-0610-30-S710";
const NOW = new Date("2025-11-01T00:00:00Z");
const UT_FORM = { work_order: "71000005", technique: "UTM-01-100%", read_date: "2025-10-20", performer: "Inspector A (synthetic)", procedure_id: "PROC-SYN-UT-01", procedure_revision: "A", instrument_id: "UTI-SYN-1", calibration_ref: "CAL-SYN-2025b", measurement_uncertainty_mm: "0.2", quality: "good" };
const CMP = { decided_by: "J. Engineer (synthetic)", rationale: "Same procedure rev A and instrument; calibrated to the same reference block (synthetic)." };

function ctx(p: Portfolio) {
  const plans = workbookToLines(p);
  return {
    plant: p.plant,
    lines: plans.map((x) => x.line),
    knownWorkOrders: new Set(p.campaigns.map((c) => c.work_order)),
    existingReadingIds: (tag: string, loc: string) => plans.find((x) => x.line.tag === tag)!.fixture.ut_rows.filter((r) => r.location_id === loc).map((r) => String(r.record_id)),
    now: NOW,
  };
}
async function rankWith(p: Portfolio) {
  const results = [];
  for (const plan of workbookToLines(p)) {
    const r = await runReplay(plan.fixture, new MetaGateway({}), () => new Date(p.as_of));
    results.push({ line: plan.line, trends: r.trends, findings: plan.findings, sensor_events: plan.fixture.sensor_events });
  }
  return rankNextSpots(results, p.as_of);
}

test("CSV parser: quotes, escaped quotes, CRLF, BOM; malformed quoting is an error", () => {
  const ok = parseCsv('﻿a,b,c\r\n1,"x, y","say ""hi"""\n');
  assert.ok(ok.status === "ok");
  if (ok.status === "ok") {
    assert.deepEqual(ok.header, ["a", "b", "c"]);
    assert.deepEqual(ok.rows, [["1", "x, y", 'say "hi"']]);
  }
  assert.equal(parseCsv('a\n"open').status, "error");
  assert.equal(parseCsv('a\n"x"y').status, "error");
  assert.equal(parseCsv('a\nx"y').status, "error");
  assert.equal(parseCsv("").status, "error");
});

test("upload: campaign-level validation (metadata, dates, work order, comparability completeness)", () => {
  const c = ctx(load());
  const bad = validateUpload(DEMO, { ...UT_FORM, procedure_id: "", measurement_uncertainty_mm: "-1", quality: "" }, undefined, c).outcome;
  assert.ok(bad.status === "rejected" && bad.errors.some((e) => /procedure id/.test(e)) && bad.errors.some((e) => /uncertainty/.test(e)) && bad.errors.some((e) => /quality/.test(e)));
  assert.ok((validateUpload(DEMO, { ...UT_FORM, read_date: "2030-01-01" }, undefined, c).outcome as { errors: string[] }).errors.some((e) => /future/.test(e)));
  assert.ok((validateUpload(DEMO, { ...UT_FORM, work_order: "71000004" }, undefined, c).outcome as { errors: string[] }).errors.some((e) => /already imported/.test(e)));
  assert.ok((validateUpload(DEMO, UT_FORM, { decided_by: "J", rationale: "" }, c).outcome as { errors: string[] }).errors.some((e) => /comparability/.test(e)));
});

test("upload: row-level rejections are reported with reasons; valid rows are kept", () => {
  const csv = [
    "Tag/Equipment,Position,Class,Point Description,UoM,Quant Reading,Qual Reading,Comment / Text",
    `${A},A-01,WTHK,Wall,mm,13.2,,`,
    `UNKNOWN/TAG,A-01,WTHK,Wall,mm,13.2,,`,
    `${A},Z-99,WTHK,Wall,mm,13.2,,`,
    `${A},A-02,WTHK,Wall,mm,abc,,`,
    `${A},A-03,WTHK,Wall,,13.8,,`,
  ].join("\n");
  const out = validateUpload(csv, UT_FORM, undefined, ctx(load())).outcome;
  assert.ok(out.status === "accepted");
  if (out.status === "accepted") {
    assert.equal(out.accepted_rows, 1);
    assert.deepEqual(out.rejected.map((r) => r.row), [3, 4, 5, 6]);
    assert.match(out.rejected[0].reason, /unknown line/);
    assert.match(out.rejected[1].reason, /not a CML/);
    assert.match(out.rejected[2].reason, /not a positive number/);
    assert.match(out.rejected[3].reason, /UoM/);
  }
  const vis = validateUpload("Tag/Equipment,Position,Qual Reading\n" + `${A},1510,no code here`, { ...UT_FORM, technique: "VIE-01-100%" }, undefined, ctx(load())).outcome;
  assert.ok(vis.status === "rejected" && vis.rejected[0].reason.includes("no valuation code"));
});

test("upload end to end: with a comparability decision the trend updates (A-02 life 3.25 y -> under 1 y); without one it is refused", async () => {
  const withDec = load();
  const r1 = validateUpload(DEMO, UT_FORM, CMP, ctx(withDec));
  assert.ok(r1.stored && r1.outcome.status === "accepted" && r1.outcome.decisions === 3);
  withDec.campaigns.push(r1.stored!.campaign);
  withDec.comparability_decisions.push(...r1.stored!.decisions);
  const a2 = (await rankWith(withDec)).find((s) => s.location_id === "A-02")!;
  assert.equal(a2.tier, 2);
  assert.ok(a2.remaining_life_years! < 1, String(a2.remaining_life_years));
  assert.ok(a2.evidence_ids.includes("WB-71000005-A-02"));

  const noDec = load();
  const r2 = validateUpload(DEMO, UT_FORM, undefined, ctx(noDec));
  noDec.campaigns.push(r2.stored!.campaign);
  const a2b = (await rankWith(noDec)).find((s) => s.location_id === "A-02")!;
  assert.ok(a2b.reasons.some((x) => /no usable trend: comparability_decision_required/.test(x)), a2b.reasons.join(" | "));
});

test("upload store: atomic, durable, duplicate work orders refused, corrupt file fails loudly", () => {
  const dir = mkdtempSync(join(tmpdir(), "icp-up-"));
  const stored = validateUpload(DEMO, UT_FORM, CMP, ctx(load())).stored!;
  const s = new UploadStore(dir);
  s.add(stored);
  assert.throws(() => s.add(stored), /already imported/);
  assert.equal(new UploadStore(dir).all.length, 1);
  assert.equal(new UploadStore(dir).all[0].campaign.origin, "replay");
  writeFileSync(join(dir, "uploads.json"), "[]");
  assert.throws(() => new UploadStore(dir), /corrupt upload store/);
});

test("C-029 P1: an import is accepted only if the engine accepts it (the review's exact probes)", async () => {
  const { ingestUTRows } = await import("../lib/integrity-copilot/ut-adapter.ts");
  const { lineRegister, toRawUTRow } = await import("../lib/integrity-copilot/workbook.ts");
  const head = "Tag/Equipment,Position,Class,Point Description,UoM,Quant Reading,Qual Reading,Comment / Text";
  const dup = validateUpload([head, `${A},A-02,WTHK,Wall,mm,10.0,,`, `${A},A-02,WTHK,Wall,mm,10.1,,`].join("\n"), { ...UT_FORM, work_order: "TEST-DUP" }, undefined, ctx(load())).outcome;
  assert.ok(dup.status === "accepted" && dup.accepted_rows === 1 && dup.rejected[0].row === 3 && /more than once/.test(dup.rejected[0].reason), JSON.stringify(dup));
  const unit = validateUpload([head, `${A},A-01,WTHK,Wall,banana,13.2,,`].join("\n"), { ...UT_FORM, work_order: "TEST-UNIT" }, undefined, ctx(load())).outcome;
  assert.ok(unit.status === "rejected" && /unit_unsupported/.test(unit.rejected[0].reason), JSON.stringify(unit));
  const date = validateUpload(DEMO, { ...UT_FORM, work_order: "TEST-DATE", read_date: "2025-02-30" }, undefined, ctx(load())).outcome;
  assert.ok(date.status === "rejected" && date.errors.some((e) => /real calendar date/.test(e)));

  // Parity: every stored row is accepted by the same adapter the engine uses.
  const p = load();
  const r = validateUpload(DEMO, UT_FORM, undefined, ctx(p));
  const line = workbookToLines(p)[0].line;
  const raws = r.stored!.campaign.rows.map((row) => toRawUTRow(p.plant, line, r.stored!.campaign, row, "2025-11-01T00:00:00Z"));
  assert.deepEqual(ingestUTRows(raws, lineRegister(p.plant, line)).rejected, []);
  assert.equal(r.stored!.campaign.ingested_at, NOW.toISOString(), "uploaded rows carry the upload time, not the portfolio's");
});

test("upload: readings attested non-good are stored but reported as excluded from trends", () => {
  const out = validateUpload(DEMO, { ...UT_FORM, quality: "suspect" }, undefined, ctx(load())).outcome;
  assert.ok(out.status === "accepted" && out.accepted_rows === 3 && out.excluded_from_trends === 3, JSON.stringify(out));
});

test("CSV and store polish: duplicate headers, UTF-8 byte limit, row limit, malformed store entries", () => {
  assert.ok((validateUpload("Tag/Equipment,Position,Position\nx,y,z", UT_FORM, undefined, ctx(load())).outcome as { errors: string[] }).errors.some((e) => /more than once/.test(e)));
  assert.equal(parseCsv("é".repeat(600), { maxBytes: 1000, maxRows: 10 }).status, "error"); // 1200 bytes, 600 chars
  assert.equal(parseCsv("h\n1\n2\n3", { maxBytes: 1000, maxRows: 2 }).status, "error");
  assert.equal(parseCsv("h\n1\n2", { maxBytes: 1000, maxRows: 2 }).status, "ok");
  const dir = mkdtempSync(join(tmpdir(), "icp-up-"));
  writeFileSync(join(dir, "uploads.json"), JSON.stringify({ version: 1, uploads: [{ nope: true }] }));
  assert.throws(() => new UploadStore(dir), /malformed upload entry/);
});

test("upload store: full nested schema check on load (C-030 polish)", async () => {
  const { storedUploadProblem } = await import("../lib/integrity-copilot/uploads.ts");
  const good = validateUpload(DEMO, UT_FORM, CMP, ctx(load())).stored!;
  assert.equal(storedUploadProblem(good), null);
  const clone = () => JSON.parse(JSON.stringify(good));
  const cases: [(x: any) => void, RegExp][] = [
    [(x) => (x.uploaded_at = "nope"), /uploaded_at/],
    [(x) => (x.campaign.read_date = "2025-02-30"), /calendar date/],
    [(x) => (x.campaign.origin = "synthetic"), /origin/],
    [(x) => delete x.campaign.quality, /quality/],
    [(x) => (x.campaign.rows[0].quant_reading = -1), /reading invalid/],
    [(x) => (x.decisions[0].rationale = ""), /decision 0/],
    [(x) => (x.decisions[0].reading_ids = []), /decision 0/],
  ];
  for (const [mutate, re] of cases) {
    const x = clone();
    mutate(x);
    assert.match(String(storedUploadProblem(x)), re);
  }
  // the reviewer's case: string timestamp + arrays + required keys only
  assert.notEqual(storedUploadProblem({ uploaded_at: "x", decisions: [], campaign: { work_order: "W", rows: [], read_date: "2025-01-01" } }), null);
  const dir = mkdtempSync(join(tmpdir(), "icp-up-"));
  const bad = clone();
  bad.campaign.rows[0].quant_reading = "abc";
  writeFileSync(join(dir, "uploads.json"), JSON.stringify({ version: 1, uploads: [bad] }));
  assert.throws(() => new UploadStore(dir), /malformed upload entry 0: row 0/);
});

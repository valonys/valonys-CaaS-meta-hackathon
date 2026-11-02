import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeCode, parseQualReading } from "../lib/integrity-copilot/codes.ts";
import { workbookToLines, type Portfolio } from "../lib/integrity-copilot/workbook.ts";
import { rankNextSpots, type LineResult } from "../lib/integrity-copilot/nextspots.ts";
import { runReplay } from "../lib/integrity-copilot/workflow.ts";
import { MetaGateway } from "../lib/integrity-copilot/gateway.ts";

const load = (): Portfolio => JSON.parse(readFileSync(new URL("../lib/integrity-copilot/fixtures/synthetic-portfolio.json", import.meta.url), "utf8"));
async function rank(p: Portfolio) {
  const results: LineResult[] = [];
  for (const plan of workbookToLines(p)) {
    const r = await runReplay(plan.fixture, new MetaGateway({}), () => new Date(p.as_of));
    results.push({ line: plan.line, trends: r.trends, findings: plan.findings, sensor_events: plan.fixture.sensor_events });
  }
  return rankNextSpots(results, p.as_of);
}

test("codes: workbook valuation codes decode deterministically; unknown codes are 'unmapped', never guessed", () => {
  assert.deepEqual(decodeCode("02co"), { code: "02CO", severity: "medium", description: "Minor coating damage (Ri2-Ri1)", mechanism: "Coating breakdown" });
  assert.equal(decodeCode("04TL").severity, "critical");
  assert.equal(decodeCode("01AS").severity, "unmapped"); // real report code absent from the map
  assert.equal(parseQualReading("02PI - 1-Pitting observed, with moderate growth")?.code, "02PI");
  assert.equal(parseQualReading("no code here"), null);
  assert.equal(parseQualReading(null), null);
});

test("workbook adapter: campaigns become per-line UT rows and decoded findings, with engineer campaign metadata as provenance", () => {
  const plans = workbookToLines(load());
  assert.deepEqual(plans.map((p) => p.line.line_number), ["NG-18-50110-S710", "WI-6-41200-S2", "PW-8-30300-S3"]);
  const a = plans[0];
  assert.equal(a.fixture.ut_rows.length, 12);
  const row = a.fixture.ut_rows.find((r) => r.record_id === "WB-71000004-A-02")!;
  assert.equal(row.thickness_value, 10.3);
  assert.equal(row.procedure_id, "PROC-SYN-UT-01");
  assert.equal(row.measurement_uncertainty_mm, 0.2);
  assert.equal(row.source_system, "inspection-workbook");
  const coat = a.findings.find((f) => f.code?.code === "02CO")!;
  assert.equal(coat.location_id, "A-02");
  assert.equal(a.findings.find((f) => f.position === "1510")!.location_id, null); // workbook position, not a CML
});

test("workbook adapter: a UT campaign without engineer metadata is rejected by the UT adapter, not filled in", async () => {
  const p = load();
  const camp = p.campaigns.find((c) => c.work_order === "71000004")!;
  delete camp.procedure_id;
  delete camp.measurement_uncertainty_mm;
  const plan = workbookToLines(p)[0];
  const r = await runReplay(plan.fixture, new MetaGateway({}), () => new Date(p.as_of));
  assert.equal(r.rejected.filter((x) => x.record_id.startsWith("WB-71000004")).length, 3);
});

test("next spots: deterministic order, tiers and numbers on the synthetic portfolio", async () => {
  const spots = await rank(load());
  assert.deepEqual(spots.map((s) => `${s.tier}:${s.location_id}`), ["2:A-02", "3:B-02", "4:C-01", "5:B-01", "5:C-02", "5:A-01", "5:A-03"]);
  const a2 = spots[0];
  assert.equal(Number(a2.remaining_life_years!.toFixed(2)), 3.25);
  assert.equal(Number(a2.governing_rate_mm_per_year!.toFixed(2)), 0.4);
  assert.equal(a2.next_inspection_due?.slice(0, 10), "2026-10-15");
  assert.equal(a2.worst_finding, "medium");
  assert.ok(a2.reasons.some((r) => r.startsWith("visual: 02CO")));
  assert.ok(spots[1].reasons.some((r) => /no usable trend: comparability_decision_required/.test(r)) && spots[1].reasons.some((r) => r.startsWith("visual: 02PI")));
  assert.ok(spots[2].reasons.some((r) => /sensor WUT-C1 silent since 2025-10-05/.test(r)));
});

test("next spots: tier 1 for below t_min, overdue, or a critical visual finding", async () => {
  const below = load();
  below.campaigns.find((c) => c.work_order === "71000004")!.rows.find((r) => r.position === "A-02")!.quant_reading = 8.9;
  assert.equal((await rank(below))[0].tier, 1);
  assert.match((await rank(below))[0].reasons[0], /at or below t_min 9 mm/);

  const overdue = load();
  overdue.as_of = "2027-01-01T00:00:00Z";
  const o = await rank(overdue);
  assert.equal(o[0].tier, 1);
  assert.match(o[0].reasons.join(" "), /next inspection was due 2026-10-15/);

  const critical = load();
  critical.campaigns.find((c) => c.work_order === "72000010")!.rows[0].qual_reading = "04TL - Crack or wall loss > 80%";
  const c = await rank(critical);
  assert.equal(c[0].tier, 1);
  assert.equal(c[0].location_id, "B-02");
});

test("proposal method comes from the trend's latest reading (no hardcoded procedure)", async () => {
  const plan = workbookToLines(load())[0];
  const r = await runReplay(plan.fixture, new MetaGateway({}), () => new Date("2025-11-01T00:00:00Z"));
  assert.equal(r.proposal.proposed_next_inspection?.method, "UTM-01-100% per PROC-SYN-UT-01 rev A (same procedure as trend basis)");
});

test("C-027 P1: mapped codes the map leaves 'unknown' (00ND, 12TL) stay visible as unranked findings", async () => {
  for (const code of ["12TL - Through thickness corrosion, leaks", "00ND - Inspection Not Done"]) {
    const p = load();
    p.campaigns.find((c) => c.work_order === "71000010")!.rows.push({ tag: p.lines[0].tag, position: "A-01", class: "DMGE", point_description: "External damage", uom: "", quant_reading: null, qual_reading: code, comment: "" });
    const a1 = (await rank(p)).find((s) => s.location_id === "A-01")!;
    assert.equal(a1.tier, 4, code);
    assert.equal(a1.tier_label, "Blind spot / unranked finding");
    assert.equal(a1.worst_finding, "unknown");
    assert.ok(a1.reasons.some((r) => r.includes(code.slice(0, 4)) && r.includes("unranked by the code map")), a1.reasons.join(" | "));
    assert.ok(a1.evidence_ids.includes("WB-71000010-A-01"));
  }
});

test("C-027 P1: no decision-bearing defaults; missing quality, register date or t_min fail closed", async () => {
  const noQuality = load();
  delete noQuality.campaigns.find((c) => c.work_order === "71000004")!.quality;
  // The adapter keeps them as records with quality "missing"; the trend engine uses only "good"
  // readings, so an unattested campaign never contributes to a rate or a remaining life.
  const plan = workbookToLines(noQuality)[0];
  assert.equal(plan.fixture.ut_rows.find((x) => x.record_id === "WB-71000004-A-02")!.quality, undefined);
  const a2nq = (await rank(noQuality)).find((s) => s.location_id === "A-02")!;
  assert.ok(!a2nq.evidence_ids.includes("WB-71000004-A-02"), "unattested reading must not enter the trend");
  assert.equal(Number(a2nq.governing_rate_mm_per_year!.toFixed(2)), 0.3, "trend falls back to the attested 2016-2022 readings");

  const noRegister = load();
  delete noRegister.lines[0].cmls.find((c) => c.id === "A-02")!.active_from;
  const r2 = await runReplay(workbookToLines(noRegister)[0].fixture, new MetaGateway({}), () => new Date(noRegister.as_of));
  assert.ok(r2.rejected.some((x) => x.record_id === "WB-71000004-A-02"), "an unregistered CML's readings are rejected");

  const noLimit = load();
  delete noLimit.lines[0].cmls.find((c) => c.id === "A-02")!.t_min;
  const a2 = (await rank(noLimit)).find((s) => s.location_id === "A-02")!;
  assert.equal(a2.tier, 3, "no t_min: no remaining life; the coating finding still ranks it");
  assert.ok(a2.reasons.some((x) => /no usable threshold: no_limit/.test(x)));

  const unapproved = load();
  unapproved.lines[0].cmls.find((c) => c.id === "A-02")!.t_min!.approval_status = "draft";
  assert.ok((await rank(unapproved)).find((s) => s.location_id === "A-02")!.reasons.some((x) => /limit_not_approved/.test(x)));

  const ut = workbookToLines(load())[0].fixture.ut_rows.find((x) => x.record_id === "WB-71000004-A-02")!;
  assert.equal(ut.inspector, "Inspector A (synthetic)");
  assert.equal(ut.quality, "good");
});

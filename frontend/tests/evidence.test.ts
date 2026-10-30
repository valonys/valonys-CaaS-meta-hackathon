import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessTrend,
  isValidTimestamp,
  thicknessToMm,
  validateProposal,
  validateUTReading,
  validateVisualObservation,
  type ComparabilityDecision,
  type EngineerLimit,
  type InspectionProposal,
  type RatePolicy,
  type UTReading,
  type VisualObservation,
} from "../lib/integrity-copilot/evidence.ts";

const asset = { plant: "DEMO", unit: "U-100", circuit: "PC-01", asset_tag: "P-101", location_id: "CML-03" };
const ING = "2026-10-28T10:00:00Z";
const eng = (ref: string) => ({ source_system: "engineer-entry", source_ref: ref, origin: "synthetic" as const, basis: "engineer_entered" as const, event_time: ING, ingested_at: ING });

function ut(id: string, time: string, mm: number, extra: Partial<UTReading> = {}): UTReading {
  return {
    kind: "ut_reading",
    id,
    asset,
    thickness_mm: mm,
    method: "UT-A-scan",
    procedure_id: "PROC-UT-01",
    procedure_revision: "B",
    instrument_id: "UT-INST-7",
    calibration_ref: "CAL-1",
    uncertainty_mm: 0.25,
    quality: "good",
    provenance: { source_system: "UT-CSV", source_ref: `fixture#${id}`, origin: "synthetic", basis: "measured", event_time: time, ingested_at: ING },
    ...extra,
  };
}

const policy: RatePolicy = {
  kind: "rate_policy",
  id: "POL-1",
  governing: "max_valid_rate",
  interval_fraction_of_remaining_life: 0.5,
  max_interval_years: 10,
  uncertainty: { combination: "linear_sum", coverage_basis: "test: conservative addition" },
  source_document: "test policy",
  approved_by: "J. Engineer",
  provenance: eng("pol"),
};

function tmin(value: number, extra: Partial<EngineerLimit> = {}): EngineerLimit {
  return {
    kind: "engineer_limit",
    id: "LIM-1",
    asset,
    limit_type: "t_min",
    value,
    unit: "mm",
    source_document: "CALC-001",
    source_revision: "A",
    entered_by: "J. Engineer",
    entered_at: ING,
    approval_status: "approved",
    provenance: eng("lim"),
    ...extra,
  };
}

// 10.25 -> 9.75 -> 9.00 mm at 2016/2020/2024-01-01: exactly 8.0 y and 4.0 y (365.25-day years).
const three = () => [ut("a", "2016-01-01T00:00:00Z", 10.25), ut("b", "2020-01-01T00:00:00Z", 9.75), ut("c", "2024-01-01T00:00:00Z", 9.0)];

test("unit conversion is exact and rejects unknown units", () => {
  assert.equal(thicknessToMm(0.5, "in"), 12.7);
  assert.equal(thicknessToMm(100, "mils"), 2.54);
  assert.throws(() => thicknessToMm(3, "cm"), /Unsupported thickness unit/);
});

test("timestamps: shape AND calendar are validated", () => {
  assert.ok(isValidTimestamp("2024-02-29T00:00:00Z"));
  assert.ok(isValidTimestamp("2024-01-01T12:30:00+01:00"));
  for (const bad of ["2023-02-29T00:00:00Z", "2023-02-30T00:00:00Z", "2024-13-01T00:00:00Z", "2024-01-01T24:00:00Z", "2024-01-01T00:00:00", "2024-01-01", 42]) {
    assert.equal(isValidTimestamp(bad), false, String(bad));
  }
});

test("hand-calculated: LT 0.15625, ST 0.1875 governs, 16 y remaining life, next due 2032-01-01", () => {
  const t = assessTrend("CML-03", three(), policy, { limit: tmin(6.0) });
  assert.equal(t.status, "assessed");
  if (t.status !== "assessed") return;
  assert.ok(t.long_term.status === "rate" && t.long_term.years === 8 && t.long_term.rate_mm_per_year === 0.15625);
  assert.ok(t.short_term.status === "rate" && t.short_term.years === 4 && t.short_term.rate_mm_per_year === 0.1875);
  assert.equal(t.governing.selected, "short_term");
  assert.equal(t.governing.rate_mm_per_year, 0.1875);
  assert.ok(t.threshold.status === "above_t_min" && t.threshold.remaining_life_years === 16);
  assert.equal(t.next_inspection_due, "2032-01-01T00:00:00.000Z"); // min(0.5 * 16, 10) = 8 y
  assert.ok(t.assumptions.includes("includes replayed or synthetic data"));
});

test("long_term_only policy keeps both rates but governs on long-term", () => {
  const t = assessTrend("CML-03", three(), { ...policy, governing: "long_term_only" }, { limit: tmin(6.0) });
  assert.ok(t.status === "assessed" && t.governing.selected === "long_term" && t.short_term.status === "rate");
});

test("latest thickness equal to or below t_min gives exceeded state, never negative life", () => {
  for (const v of [9.0, 9.5]) {
    const t = assessTrend("CML-03", three(), policy, { limit: tmin(v) });
    assert.ok(t.status === "assessed" && t.threshold.status === "at_or_below_t_min", `t_min ${v}`);
    assert.equal(t.status === "assessed" ? t.next_inspection_due : "x", undefined);
  }
});

test("t_min must be positive, sourced, entered and approved", () => {
  const cases: [Partial<EngineerLimit>, string][] = [
    [{ value: 0 }, "limit_invalid"],
    [{ value: -1 }, "limit_invalid"],
    [{ source_document: "" }, "limit_invalid"],
    [{ source_revision: " " }, "limit_invalid"],
    [{ entered_by: "" }, "limit_invalid"],
    [{ unit: "cm" }, "limit_invalid"],
    [{ entered_at: "2026-02-30T00:00:00Z" }, "limit_invalid"],
    [{ approval_status: "draft" }, "limit_not_approved"],
  ];
  for (const [extra, expected] of cases) {
    const t = assessTrend("CML-03", three(), policy, { limit: tmin(6.0, extra) });
    assert.ok(t.status === "assessed" && t.threshold.status === expected, JSON.stringify(extra));
  }
});

test("change within combined uncertainty is not wall loss", () => {
  const t = assessTrend("CML-03", [ut("a", "2020-01-01T00:00:00Z", 8.0), ut("b", "2024-01-01T00:00:00Z", 7.875)], policy, { limit: tmin(6.0) });
  assert.ok(t.status === "assessed" && t.long_term.status === "within_uncertainty");
  assert.ok(t.status === "assessed" && t.governing.rate_mm_per_year === null);
  assert.ok(t.status === "assessed" && t.threshold.status === "above_t_min" && t.threshold.remaining_life_years === null);
});

test("refusals: insufficient, duplicate time, mixed procedure, calibration change without decision", () => {
  const reason = (rs: UTReading[], decisions?: ComparabilityDecision[]) => {
    const t = assessTrend("CML-03", rs, policy, { decisions });
    return t.status === "refused" ? t.reasons.map((r) => r.reason) : [];
  };
  assert.deepEqual(reason([ut("a", "2020-01-01T00:00:00Z", 10)]), ["insufficient_history"]);
  assert.ok(reason([ut("a", "2020-01-01T00:00:00Z", 10), ut("b", "2020-01-01T01:00:00+01:00", 9)]).includes("duplicate_event_time"));
  assert.ok(reason([ut("a", "2020-01-01T00:00:00Z", 10), ut("b", "2024-01-01T00:00:00Z", 9, { procedure_revision: "C" })]).includes("procedure_mismatch"));
  assert.ok(reason([ut("a", "2020-01-01T00:00:00Z", 10), ut("b", "2024-01-01T00:00:00Z", 9, { method: "UT-C-scan" })]).includes("procedure_mismatch"));
  const recal = [ut("a", "2020-01-01T00:00:00Z", 10), ut("b", "2024-01-01T00:00:00Z", 9, { calibration_ref: "CAL-2" })];
  assert.ok(reason(recal).includes("comparability_decision_required"));
  const decision: ComparabilityDecision = { kind: "comparability_decision", id: "D1", location_id: "CML-03", reading_ids: ["a", "b"], rationale: "same block", decided_by: "J. Engineer", decided_at: ING, provenance: eng("d1") };
  assert.deepEqual(reason(recal, [decision]), []);
  assert.ok(reason(recal, [{ ...decision, reading_ids: ["a"] }]).includes("comparability_decision_required"));
  assert.ok(reason(recal, [{ ...decision, decided_by: "" }]).includes("comparability_decision_required"));
});

test("runtime validation rejects bad basis, model-inferred thickness and missing context", () => {
  const bad = ut("x", "2024-01-01T00:00:00Z", 9);
  (bad.provenance as { basis: string }).basis = "model_inferred";
  assert.ok(validateUTReading(bad).some((e) => /must be measured/.test(e)));
  const weird = ut("y", "2024-01-01T00:00:00Z", 9);
  (weird.provenance as { basis: string }).basis = "guess";
  assert.ok(validateUTReading(weird).some((e) => /invalid basis/.test(e)));
  assert.ok(validateUTReading(ut("z", "2024-01-01T00:00:00Z", 9, { calibration_ref: "" })).some((e) => /calibration_ref/.test(e)));
  assert.ok(validateUTReading(ut("w", "2024-01-01T00:00:00Z", 9, { uncertainty_mm: -0.1 })).some((e) => /uncertainty/.test(e)));
});

test("visual observations cannot carry thickness", () => {
  const obs = {
    kind: "visual_observation", id: "v1", asset, image_ref: "img-1", prompt: "corrosion", label: "corrosion", inspector_confirmed: false, thickness_mm: 4.2,
    provenance: { source_system: "camera", source_ref: "img-1", origin: "replay", basis: "model_inferred", event_time: "2024-01-01T00:00:00Z", ingested_at: ING, model: { provider: "meta", model_id: "sam-3.1", call_id: "c1", recorded: true } },
  } as unknown as VisualObservation;
  assert.ok(validateVisualObservation(obs).some((e) => /photographs never supply measurements/.test(e)));
});

test("proposal: unknown and out-of-scope evidence, decision needs engineer + decided_at + rationale", () => {
  const p: InspectionProposal = {
    kind: "inspection_proposal", id: "p1", asset, summary: "s",
    findings: [
      { text: "a", evidence: [{ record_kind: "ut_reading", record_id: "ghost" }], basis: "derived" },
      { text: "b", evidence: [{ record_kind: "ut_reading", record_id: "other-asset" }], basis: "derived" },
    ],
    data_gaps: [],
    status: "approved",
    approval: { engineer: "J. Engineer", decided_at: "not-a-date", rationale: " " },
    provenance: { source_system: "copilot", source_ref: "p1", origin: "synthetic", basis: "derived", event_time: ING, ingested_at: ING },
  };
  const known = new Map([["other-asset", { ...asset, asset_tag: "P-999" }]]);
  const errors = validateProposal(p, known);
  assert.ok(errors.some((e) => /unknown record "ghost"/.test(e)));
  assert.ok(errors.some((e) => /outside the proposal asset scope/.test(e)));
  assert.ok(errors.some((e) => /valid decided_at/.test(e)));
  assert.ok(errors.some((e) => /rationale/.test(e)));
});

// ---------- C-004 review regressions (review findings 2, 3 and the uncertainty-policy verdict) ----------

const decisionFor = (ids: string[]): ComparabilityDecision => ({ kind: "comparability_decision", id: "D-CTX", location_id: "CML-03", reading_ids: ids, rationale: "temperature-compensated per procedure", decided_by: "J. Engineer", decided_at: ING, provenance: eng("dctx") });

test("C-004 #2: differing surface temperature / couplant / coating needs an engineer decision", () => {
  const hot = [
    ut("a", "2020-01-01T00:00:00Z", 10, { context: { surface_temp_c: 20, couplant: "A" } }),
    ut("b", "2024-01-01T00:00:00Z", 9, { context: { surface_temp_c: 80, couplant: "B" } }),
  ];
  const t = assessTrend("CML-03", hot, policy);
  assert.ok(t.status === "refused" && t.reasons.some((r) => r.reason === "comparability_decision_required" && /couplant/.test(r.detail) && /temperature/.test(r.detail)));
  assert.equal(assessTrend("CML-03", hot, policy, { decisions: [decisionFor(["a", "b"])] }).status, "assessed");

  const coated = [ut("a", "2020-01-01T00:00:00Z", 10, { context: { coating: "epoxy" } }), ut("b", "2024-01-01T00:00:00Z", 9)];
  assert.equal(assessTrend("CML-03", coated, policy).status, "refused");
  const partialTemp = [ut("a", "2020-01-01T00:00:00Z", 10, { context: { surface_temp_c: 25 } }), ut("b", "2024-01-01T00:00:00Z", 9)];
  assert.equal(assessTrend("CML-03", partialTemp, policy).status, "refused");

  const close = [ut("a", "2020-01-01T00:00:00Z", 10, { context: { surface_temp_c: 24 } }), ut("b", "2024-01-01T00:00:00Z", 9, { context: { surface_temp_c: 26 } })];
  assert.equal(assessTrend("CML-03", close, policy).status, "refused");
  assert.equal(assessTrend("CML-03", close, { ...policy, surface_temp_tolerance_c: 5 }).status, "assessed");
});

test("C-004 #3: wall gain beyond uncertainty is indeterminate, never a governing rate", () => {
  const t = assessTrend("CML-03", [ut("a", "2020-01-01T00:00:00Z", 9.0), ut("b", "2024-01-01T00:00:00Z", 10.0)], policy, { limit: tmin(6.0) });
  assert.ok(t.status === "assessed");
  if (t.status !== "assessed") return;
  assert.equal(t.long_term.status, "thickness_gain");
  assert.equal(t.governing.rate_mm_per_year, null);
  assert.equal(t.governing.selected, null);
  assert.match(t.governing.rationale, /wall gain/);
  assert.ok(t.threshold.status === "above_t_min" && t.threshold.remaining_life_years === null);
  assert.equal(t.next_inspection_due, undefined);

  // Gain on ST, loss on LT: only the positive LT loss may govern.
  const mixed = assessTrend("CML-03", [ut("a", "2016-01-01T00:00:00Z", 11.0), ut("b", "2020-01-01T00:00:00Z", 8.5), ut("c", "2024-01-01T00:00:00Z", 9.5)], policy);
  assert.ok(mixed.status === "assessed" && mixed.short_term.status === "thickness_gain" && mixed.governing.selected === "long_term" && mixed.governing.rate_mm_per_year! > 0);
});

test("uncertainty policy: rule is required; RSS vs linear sum changes significance", () => {
  const pair = [ut("a", "2020-01-01T00:00:00Z", 10.0), ut("b", "2024-01-01T00:00:00Z", 9.6)]; // 0.40 mm change, u = 0.25 each
  const rss = assessTrend("CML-03", pair, { ...policy, uncertainty: { combination: "rss_independent", coverage_basis: "procedure: independent 1σ" } });
  assert.ok(rss.status === "assessed" && rss.long_term.status === "rate"); // 0.40 > 0.3536
  const lin = assessTrend("CML-03", pair, policy);
  assert.ok(lin.status === "assessed" && lin.long_term.status === "within_uncertainty"); // 0.40 <= 0.50
  const none = assessTrend("CML-03", pair, { ...policy, uncertainty: undefined as unknown as RatePolicy["uncertainty"] });
  assert.ok(none.status === "refused" && none.reasons.some((r) => r.reason === "uncertainty_invalid"));
});

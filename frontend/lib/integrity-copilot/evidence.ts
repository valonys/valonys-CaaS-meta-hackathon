// Integrity Copilot evidence contracts (hackathon route).
// Canonical spec: packages/wireless-ut/framework/{README,ADAPTERS,WORKFLOW}.md
//
// Rules this file encodes:
// - Every record carries provenance and says whether it is live, replayed or synthetic.
// - Wall thickness only ever comes from a measured UT reading. Visual observations have no
//   thickness field; model-inferred values can never become measurements.
// - Units, dates, comparability, rates and thresholds are deterministic. Unknown or invalid
//   input is rejected with a reason code, never repaired or guessed.
// - Engineering choices (t_min, rate policy, comparability exceptions, approval) are explicit
//   engineer-entered records.
// - This module imports nothing: no provider SDK can reach the contracts.

export type DataOrigin = "live" | "replay" | "synthetic";
export type Basis = "measured" | "derived" | "model_inferred" | "engineer_entered";
export type Quality = "good" | "suspect" | "bad" | "stale" | "missing";

const ORIGINS: readonly string[] = ["live", "replay", "synthetic"];
const BASES: readonly string[] = ["measured", "derived", "model_inferred", "engineer_entered"];
const QUALITIES: readonly string[] = ["good", "suspect", "bad", "stale", "missing"];

export type RejectReason =
  | "asset_ambiguous"
  | "location_unknown"
  | "unit_unsupported"
  | "value_invalid"
  | "method_missing"
  | "procedure_missing"
  | "procedure_mismatch"
  | "calibration_missing"
  | "comparability_decision_required"
  | "uncertainty_invalid"
  | "timestamp_invalid"
  | "duplicate_event_time"
  | "quality_not_usable"
  | "basis_not_measured"
  | "provenance_incomplete"
  | "insufficient_history";

export interface Provenance {
  source_system: string; // e.g. "PI", "UT-CSV", "camera", "CMMS-history"
  source_ref: string; // file name + row, PI tag, image id ...
  origin: DataOrigin;
  basis: Basis;
  event_time: string; // ISO-8601 with offset: when it happened in the plant
  ingested_at: string; // ISO-8601 with offset: when we loaded it
  model?: ModelProvenance; // required when basis === "model_inferred"
}

export interface ModelProvenance {
  provider: "meta"; // only Meta is representable
  model_id: string; // actual id returned by the API, not the requested one
  call_id: string; // gateway usage-log id
  recorded: boolean; // true = replayed recorded output, not a live call
}

// Plant > Unit > Circuit > Asset > InspectionLocation
export interface AssetNode {
  plant: string;
  unit: string;
  circuit: string;
  asset_tag: string;
  location_id?: string; // CML / TML id
}

export interface ProcessSample {
  kind: "process_sample";
  id: string;
  asset: AssetNode;
  pi_tag: string;
  value: number | null; // null when quality is "missing"; never zero-filled
  unit: string;
  quality: Quality;
  provenance: Provenance;
}

export interface UTReading {
  kind: "ut_reading";
  id: string;
  asset: AssetNode & { location_id: string };
  thickness_mm: number;
  nominal_mm?: number;
  method: string; // approved technique name, e.g. "UT-A-scan"
  procedure_id: string;
  procedure_revision: string;
  instrument_id: string;
  calibration_ref: string;
  uncertainty_mm: number; // traceable to the procedure
  context?: { surface_temp_c?: number; couplant?: string; coating?: string };
  inspector?: string;
  quality: Quality;
  provenance: Provenance & { basis: "measured" };
}

export interface VisualObservation {
  kind: "visual_observation";
  id: string;
  asset: AssetNode;
  image_ref: string;
  frame_index?: number; // video: SAM's explicit <Nf> value
  frame_time?: { seconds: number; derivation: "container_pts" | "verified_cfr"; timebase: string };
  prompt: string; // SAM noun phrase
  box_px?: { x1: number; y1: number; x2: number; y2: number; w: number; h: number };
  mask_ref?: string;
  confidence?: number; // 0..1, only when requested from SAM
  label: string; // segmentation label, NOT a damage-mechanism or depth claim
  inspector_confirmed: boolean;
  provenance: Provenance;
  // Deliberately no thickness / depth / remaining-life fields.
}

export interface EngineerLimit {
  kind: "engineer_limit";
  id: string;
  asset: AssetNode & { location_id: string };
  limit_type: "t_min";
  value: number;
  unit: string;
  source_document: string;
  source_revision: string;
  entered_by: string;
  entered_at: string;
  approval_status: "draft" | "approved";
  provenance: Provenance & { basis: "engineer_entered" };
}

// Engineer-approved exception: readings with different instruments/calibrations or measurement
// context (surface temperature, couplant, coating) may be trended together.
export interface ComparabilityDecision {
  kind: "comparability_decision";
  id: string;
  location_id: string;
  reading_ids: string[];
  rationale: string;
  decided_by: string;
  decided_at: string;
  provenance: Provenance & { basis: "engineer_entered" };
}

// Named, approved governing-rate and interval policy (site/standard owned, never hard-coded).
export interface RatePolicy {
  kind: "rate_policy";
  id: string;
  governing: "max_valid_rate" | "long_term_only";
  interval_fraction_of_remaining_life: number; // e.g. 0.5
  max_interval_years: number;
  // How two readings' uncertainties combine before a change counts as wall loss. RSS is valid only
  // when the procedure states they are independent standard uncertainties; otherwise linear_sum.
  uncertainty: { combination: "rss_independent" | "linear_sum"; coverage_basis: string };
  // Surface-temperature difference (°C) tolerated without an engineer comparability decision.
  // Absent means any difference needs a decision.
  surface_temp_tolerance_c?: number;
  source_document: string;
  approved_by: string;
  provenance: Provenance & { basis: "engineer_entered" };
}

export interface EvidenceReference {
  record_kind:
    | "process_sample"
    | "ut_reading"
    | "visual_observation"
    | "engineer_limit"
    | "comparability_decision"
    | "rate_policy"
    | "asset_history";
  record_id: string;
}

export interface Finding {
  text: string;
  evidence: EvidenceReference[];
  basis: Basis;
}

export interface InspectionProposal {
  kind: "inspection_proposal";
  id: string;
  asset: AssetNode;
  summary: string;
  findings: Finding[];
  data_gaps: string[];
  proposed_next_inspection?: { method: string; due_by: string; rationale: string; evidence: EvidenceReference[] };
  status: "draft" | "approved" | "rejected";
  approval?: { engineer: string; decided_at: string; rationale: string };
  provenance: Provenance;
}

// ---------- Deterministic units and time ----------

const THICKNESS_TO_MM: Record<string, number> = { mm: 1, in: 25.4, inch: 25.4, mil: 0.0254, mils: 0.0254 };

export function thicknessToMm(value: number, unit: string): number {
  const factor = THICKNESS_TO_MM[unit.trim().toLowerCase()];
  if (factor === undefined) throw new Error(`Unsupported thickness unit: "${unit}"`);
  if (!Number.isFinite(value)) throw new Error(`Non-finite thickness value: ${value}`);
  return value * factor;
}

const ISO_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

// Shape AND calendar validity (rejects 2023-02-30, 25:00, missing offsets).
export function isValidTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_WITH_OFFSET.exec(value);
  if (!m) return false;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || s > 59) return false;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d >= 1 && d <= daysInMonth && Number.isFinite(Date.parse(value));
}

export const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

export function addYears(iso: string, years: number): string {
  return new Date(Date.parse(iso) + years * MS_PER_YEAR).toISOString();
}

// ---------- Validation (runtime: inputs arrive as untyped JSON) ----------

export function validateProvenance(p: Provenance | undefined): string[] {
  if (!p || typeof p !== "object") return ["provenance: missing"];
  const errors: string[] = [];
  if (!p.source_system || !p.source_ref) errors.push("provenance: source_system and source_ref are required");
  if (!ORIGINS.includes(p.origin)) errors.push(`provenance: invalid origin "${p.origin}"`);
  if (!BASES.includes(p.basis)) errors.push(`provenance: invalid basis "${p.basis}"`);
  if (!isValidTimestamp(p.event_time)) errors.push("provenance: event_time is not a valid ISO-8601 timestamp with offset");
  if (!isValidTimestamp(p.ingested_at)) errors.push("provenance: ingested_at is not a valid ISO-8601 timestamp with offset");
  if (p.basis === "model_inferred") {
    if (!p.model) errors.push("provenance: model_inferred requires model provenance");
    else if (p.model.provider !== "meta") errors.push(`provenance: non-Meta model provider "${p.model.provider}"`);
  }
  return errors;
}

export function validateUTReading(r: UTReading): string[] {
  const errors = validateProvenance(r.provenance);
  if (r.provenance?.basis !== "measured") errors.push("ut_reading: thickness must be measured, not inferred");
  if (!r.asset?.location_id) errors.push("ut_reading: location_id (CML) is required");
  if (!(Number.isFinite(r.thickness_mm) && r.thickness_mm > 0)) errors.push("ut_reading: thickness_mm must be a positive number");
  if (r.nominal_mm !== undefined && !(r.nominal_mm > 0)) errors.push("ut_reading: nominal_mm must be > 0");
  if (!r.method) errors.push("ut_reading: method is required");
  if (!r.procedure_id || !r.procedure_revision) errors.push("ut_reading: procedure_id and procedure_revision are required");
  if (!r.instrument_id || !r.calibration_ref) errors.push("ut_reading: instrument_id and calibration_ref are required");
  if (!(Number.isFinite(r.uncertainty_mm) && r.uncertainty_mm >= 0)) errors.push("ut_reading: uncertainty_mm must be >= 0");
  if (!QUALITIES.includes(r.quality)) errors.push(`ut_reading: invalid quality "${r.quality}"`);
  return errors;
}

export function validateVisualObservation(o: VisualObservation): string[] {
  const errors = validateProvenance(o.provenance);
  for (const banned of ["thickness_mm", "depth_mm", "remaining_life_years", "corrosion_rate_mm_per_year"]) {
    if (banned in (o as unknown as Record<string, unknown>)) {
      errors.push(`visual_observation: "${banned}" is not allowed; photographs never supply measurements`);
    }
  }
  if (o.confidence !== undefined && !(o.confidence >= 0 && o.confidence <= 1)) {
    errors.push("visual_observation: confidence must be within 0..1");
  }
  return errors;
}

export function validateEngineerLimit(l: EngineerLimit): string[] {
  const errors = validateProvenance(l.provenance);
  if (l.provenance?.basis !== "engineer_entered") errors.push("engineer_limit: basis must be engineer_entered");
  if (!(Number.isFinite(l.value) && l.value > 0)) errors.push("engineer_limit: value must be a positive number");
  try {
    thicknessToMm(l.value, l.unit);
  } catch {
    errors.push(`engineer_limit: unsupported unit "${l.unit}"`);
  }
  if (!l.source_document?.trim() || !l.source_revision?.trim()) errors.push("engineer_limit: source_document and source_revision are required");
  if (!l.entered_by?.trim()) errors.push("engineer_limit: entered_by is required");
  if (!isValidTimestamp(l.entered_at)) errors.push("engineer_limit: entered_at is not a valid timestamp");
  return errors;
}

function sameScope(a: AssetNode, b: AssetNode): boolean {
  return a.plant === b.plant && a.unit === b.unit && a.circuit === b.circuit && a.asset_tag === b.asset_tag;
}

// `known` maps every evidence record id to the asset it belongs to.
export function validateProposal(p: InspectionProposal, known: Map<string, AssetNode>): string[] {
  const errors = validateProvenance(p.provenance);
  const check = (where: string, refs: EvidenceReference[]) => {
    if (refs.length === 0) errors.push(`proposal: ${where} has no evidence`);
    for (const e of refs) {
      const scope = known.get(e.record_id);
      if (!scope) errors.push(`proposal: ${where} cites unknown record "${e.record_id}"`);
      else if (!sameScope(scope, p.asset)) errors.push(`proposal: ${where} cites "${e.record_id}" outside the proposal asset scope`);
    }
  };
  p.findings.forEach((f, i) => check(`finding ${i}`, f.evidence));
  if (p.proposed_next_inspection) check("proposed_next_inspection", p.proposed_next_inspection.evidence);
  if (p.status !== "draft") {
    const a = p.approval;
    if (!a?.engineer?.trim()) errors.push("proposal: a decision requires a named engineer");
    if (!a || !isValidTimestamp(a.decided_at)) errors.push("proposal: a decision requires a valid decided_at");
    if (!a?.rationale?.trim()) errors.push("proposal: a decision requires a rationale");
  }
  return errors;
}

// ---------- Deterministic comparability, rates and thresholds ----------

export type RateResult =
  | {
      status: "rate";
      from_id: string;
      to_id: string;
      years: number;
      change_mm: number;
      combined_uncertainty_mm: number;
      rate_mm_per_year: number; // positive = wall loss
    }
  | { status: "within_uncertainty"; from_id: string; to_id: string; change_mm: number; combined_uncertainty_mm: number }
  // Wall GAIN beyond uncertainty: not a corrosion rate, never a governing candidate.
  | { status: "thickness_gain"; from_id: string; to_id: string; change_mm: number; combined_uncertainty_mm: number; rationale: string }
  | { status: "unavailable"; reason: RejectReason; detail: string };

export type ThresholdState =
  | { status: "no_limit" }
  | { status: "limit_invalid"; limit_id: string; errors: string[] }
  | { status: "limit_not_approved"; limit_id: string }
  | { status: "above_t_min"; limit_id: string; t_min_mm: number; remaining_life_years: number | null; note: string }
  | { status: "at_or_below_t_min"; limit_id: string; t_min_mm: number; latest_mm: number };

export type TrendAssessment =
  | { status: "refused"; location_id: string; reasons: { reason: RejectReason; detail: string }[] }
  | {
      status: "assessed";
      location_id: string;
      reading_ids: string[];
      latest: { id: string; time: string; thickness_mm: number };
      long_term: RateResult;
      short_term: RateResult;
      governing: { policy_id: string; selected: "long_term" | "short_term" | null; rate_mm_per_year: number | null; rationale: string };
      threshold: ThresholdState;
      next_inspection_due?: string;
      assumptions: string[];
    };

export function combinedUncertainty(a: number, b: number, rule: RatePolicy["uncertainty"]["combination"]): number {
  return rule === "rss_independent" ? Math.sqrt(a ** 2 + b ** 2) : a + b;
}

function rateBetween(a: UTReading, b: UTReading, rule: RatePolicy["uncertainty"]["combination"]): RateResult {
  const years = (Date.parse(b.provenance.event_time) - Date.parse(a.provenance.event_time)) / MS_PER_YEAR;
  const change = a.thickness_mm - b.thickness_mm;
  const u = combinedUncertainty(a.uncertainty_mm, b.uncertainty_mm, rule);
  if (Math.abs(change) <= u) {
    return { status: "within_uncertainty", from_id: a.id, to_id: b.id, change_mm: change, combined_uncertainty_mm: u };
  }
  if (change < 0) {
    return {
      status: "thickness_gain",
      from_id: a.id,
      to_id: b.id,
      change_mm: change,
      combined_uncertainty_mm: u,
      rationale: "measured wall gain beyond uncertainty: indeterminate (check CML location, procedure, laminations or repair); not a corrosion rate",
    };
  }
  return {
    status: "rate",
    from_id: a.id,
    to_id: b.id,
    years,
    change_mm: change,
    combined_uncertainty_mm: u,
    rate_mm_per_year: change / years,
  };
}

// Trend at ONE CML. Refuses instead of computing from non-comparable data.
// Long-term = earliest vs latest; short-term = previous vs latest (needs >= 3 readings).
export function assessTrend(
  locationId: string,
  readings: UTReading[],
  policy: RatePolicy,
  opts: { limit?: EngineerLimit; decisions?: ComparabilityDecision[] } = {}
): TrendAssessment {
  const reasons: { reason: RejectReason; detail: string }[] = [];
  const atCml = readings.filter((r) => r.asset.location_id === locationId);
  const usable = atCml.filter((r) => r.quality === "good" && validateUTReading(r).length === 0);
  if (usable.length < 2) {
    return { status: "refused", location_id: locationId, reasons: [{ reason: "insufficient_history", detail: `${usable.length} good, valid reading(s) at ${locationId}; need at least 2` }] };
  }

  const times = usable.map((r) => r.provenance.event_time);
  const dupes = times.filter((t, i) => times.findIndex((x) => Date.parse(x) === Date.parse(t)) !== i);
  if (dupes.length) reasons.push({ reason: "duplicate_event_time", detail: `duplicate reading time(s): ${[...new Set(dupes)].join(", ")}` });

  const distinct = (f: (r: UTReading) => string) => [...new Set(usable.map(f))];
  const methods = distinct((r) => r.method);
  if (methods.length > 1) reasons.push({ reason: "procedure_mismatch", detail: `mixed methods: ${methods.join(", ")}` });
  const procedures = distinct((r) => `${r.procedure_id} rev ${r.procedure_revision}`);
  if (procedures.length > 1) reasons.push({ reason: "procedure_mismatch", detail: `mixed procedures: ${procedures.join(", ")}` });

  const rule = policy.uncertainty?.combination;
  if ((rule !== "rss_independent" && rule !== "linear_sum") || !policy.uncertainty?.coverage_basis?.trim()) {
    reasons.push({ reason: "uncertainty_invalid", detail: `rate policy ${policy.id} must name an uncertainty combination rule and coverage basis` });
  }

  // Anything that makes two readings non-comparable without an engineer decision.
  const differences: string[] = [];
  const instrumentContexts = distinct((r) => `${r.instrument_id}/${r.calibration_ref}`);
  if (instrumentContexts.length > 1) differences.push(`instrument/calibration differ (${instrumentContexts.join(", ")})`);
  for (const key of ["couplant", "coating"] as const) {
    const vals = distinct((r) => r.context?.[key]?.trim() || "(unrecorded)");
    if (vals.length > 1) differences.push(`${key} differs (${vals.join(", ")})`);
  }
  const temps = usable.map((r) => r.context?.surface_temp_c);
  const known = temps.filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  if (known.length && known.length < temps.length) differences.push("surface temperature recorded for some readings only");
  else if (known.length) {
    const spread = Math.max(...known) - Math.min(...known);
    const tol = policy.surface_temp_tolerance_c ?? 0;
    if (spread > tol) differences.push(`surface temperature spread ${spread} °C exceeds ${tol} °C`);
  }

  if (differences.length) {
    const ids = usable.map((r) => r.id);
    const covered = (opts.decisions ?? []).some(
      (d) =>
        d.location_id === locationId &&
        d.decided_by?.trim() &&
        isValidTimestamp(d.decided_at) &&
        d.rationale?.trim() &&
        ids.every((id) => d.reading_ids.includes(id))
    );
    if (!covered) {
      reasons.push({
        reason: "comparability_decision_required",
        detail: `${differences.join("; ")} and no engineer comparability decision covers all readings`,
      });
    }
  }
  if (reasons.length) return { status: "refused", location_id: locationId, reasons };

  const sorted = [...usable].sort((a, b) => Date.parse(a.provenance.event_time) - Date.parse(b.provenance.event_time));
  const first = sorted[0];
  const prev = sorted[sorted.length - 2];
  const last = sorted[sorted.length - 1];
  const longTerm = rateBetween(first, last, rule);
  const shortTerm: RateResult =
    sorted.length >= 3
      ? rateBetween(prev, last, rule)
      : { status: "unavailable", reason: "insufficient_history", detail: "short-term rate needs at least 3 comparable readings" };

  const assumptions = [
    "long-term: earliest vs latest; short-term: previous vs latest (same CML, method, procedure)",
    `change within the combined uncertainty (${rule === "rss_independent" ? "root-sum-square, independent" : "linear sum"}; ${policy.uncertainty.coverage_basis}) is not treated as wall loss`,
    "only a positive wall-loss rate beyond uncertainty is a valid governing candidate; wall gain is reported as indeterminate",
  ];
  if (sorted.some((r) => r.provenance.origin !== "live")) assumptions.push("includes replayed or synthetic data");

  // Governing rate under the named policy.
  const candidates: { name: "long_term" | "short_term"; rate: number }[] = [];
  // "valid" = comparable, uncertainty-significant, positive wall loss (rateBetween guarantees > 0).
  if (longTerm.status === "rate") candidates.push({ name: "long_term", rate: longTerm.rate_mm_per_year });
  if (policy.governing === "max_valid_rate" && shortTerm.status === "rate") candidates.push({ name: "short_term", rate: shortTerm.rate_mm_per_year });
  const chosen = candidates.sort((a, b) => b.rate - a.rate)[0];
  const governing = chosen
    ? { policy_id: policy.id, selected: chosen.name, rate_mm_per_year: chosen.rate, rationale: `${policy.governing} under ${policy.id} (${policy.source_document}); candidates: ${candidates.map((c) => `${c.name}=${c.rate}`).join(", ")}` }
    : {
        policy_id: policy.id,
        selected: null,
        rate_mm_per_year: null,
        rationale: [longTerm, shortTerm].some((r) => r.status === "thickness_gain")
          ? "no positive wall-loss rate beyond uncertainty; wall gain observed (indeterminate, engineer review)"
          : "no rate exceeds measurement uncertainty",
      };

  // Threshold against an engineer-entered, approved t_min.
  let threshold: ThresholdState = { status: "no_limit" };
  let nextDue: string | undefined;
  const limit = opts.limit;
  if (limit) {
    const limitErrors = validateEngineerLimit(limit);
    if (limit.asset.location_id !== locationId) limitErrors.push(`engineer_limit: belongs to ${limit.asset.location_id}, not ${locationId}`);
    if (limitErrors.length) threshold = { status: "limit_invalid", limit_id: limit.id, errors: limitErrors };
    else if (limit.approval_status !== "approved") threshold = { status: "limit_not_approved", limit_id: limit.id };
    else {
      const tMin = thicknessToMm(limit.value, limit.unit);
      if (last.thickness_mm <= tMin) {
        threshold = { status: "at_or_below_t_min", limit_id: limit.id, t_min_mm: tMin, latest_mm: last.thickness_mm };
      } else if (governing.rate_mm_per_year !== null && governing.rate_mm_per_year > 0) {
        const life = (last.thickness_mm - tMin) / governing.rate_mm_per_year;
        threshold = { status: "above_t_min", limit_id: limit.id, t_min_mm: tMin, remaining_life_years: life, note: `(${last.thickness_mm} - ${tMin}) / ${Number(governing.rate_mm_per_year.toFixed(4))}` };
        const interval = Math.min(life * policy.interval_fraction_of_remaining_life, policy.max_interval_years);
        nextDue = addYears(last.provenance.event_time, interval);
      } else {
        threshold = { status: "above_t_min", limit_id: limit.id, t_min_mm: tMin, remaining_life_years: null, note: "no measurable wall loss: remaining life not computed" };
      }
    }
  }

  return {
    status: "assessed",
    location_id: locationId,
    reading_ids: sorted.map((r) => r.id),
    latest: { id: last.id, time: last.provenance.event_time, thickness_mm: last.thickness_mm },
    long_term: longTerm,
    short_term: shortTerm,
    governing,
    threshold,
    next_inspection_due: nextDue,
    assumptions,
  };
}

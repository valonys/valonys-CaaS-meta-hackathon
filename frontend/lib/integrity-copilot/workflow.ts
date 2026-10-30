// One-circuit replay workflow (framework/README.md "End-to-end framework flow", ADOPTION.md scenario).
//
// Deterministic steps produce every number and finding. The Meta gateway may only add a
// plain-language summary of those findings, labelled model_inferred; it never changes a record.
// A Meta outage is an explicit state and the deterministic result stays complete.

import { numericContent, prepareModelInput, restoreAliases } from "./faithfulness.ts";
import {
  assessTrend,
  validateProposal,
  isValidTimestamp,
  type AssetNode,
  type ComparabilityDecision,
  type EngineerLimit,
  type EvidenceReference,
  type Finding,
  type InspectionProposal,
  type ProcessSample,
  type RatePolicy,
  type TrendAssessment,
  type UTReading,
} from "./evidence.ts";
import { ingestUTRows, type LocationRecord, type RawUTRow, type Rejected } from "./ut-adapter.ts";
import type { MetaGateway, UsageEntry } from "./gateway.ts";

export interface SensorEvent {
  record_id: string;
  sensor_id: string;
  location_id: string;
  event_type: string;
  event_time: string;
  source_ref: string;
}

export interface CircuitFixture {
  _label: string;
  asset: AssetNode;
  register: LocationRecord[];
  ut_rows: RawUTRow[];
  comparability_decisions: ComparabilityDecision[];
  limits: EngineerLimit[];
  rate_policy: RatePolicy;
  process_samples: ProcessSample[];
  sensor_events: SensorEvent[];
}

export type MetaSummary =
  | { status: "ok"; text: string; model_id: string; call_id: string; basis: "model_inferred" }
  | { status: "unavailable" | "error"; reason: string; detail: string };

export interface WorkflowResult {
  data_label: string;
  origins: string[];
  asset: AssetNode;
  framework_state: "monitoring" | "exception_open";
  accepted_ut: UTReading[];
  rejected: Rejected[];
  trends: TrendAssessment[];
  process_samples: ProcessSample[];
  sensor_events: SensorEvent[];
  data_gaps: string[];
  proposal: InspectionProposal;
  proposal_errors: string[];
  meta_summary: MetaSummary;
  usage: UsageEntry[];
}

const ref = (record_kind: EvidenceReference["record_kind"], record_id: string): EvidenceReference => ({ record_kind, record_id });
const fmt = (n: number) => Number(n.toFixed(4)).toString();

export function evidenceIndex(fx: CircuitFixture, accepted: UTReading[]): Map<string, AssetNode> {
  const m = new Map<string, AssetNode>();
  for (const r of accepted) m.set(r.id, r.asset);
  for (const l of fx.limits) m.set(l.id, l.asset);
  for (const d of fx.comparability_decisions) m.set(d.id, { ...fx.asset, location_id: d.location_id });
  for (const p of fx.process_samples) m.set(p.id, p.asset);
  m.set(fx.rate_policy.id, fx.asset);
  return m;
}

export async function runReplay(fx: CircuitFixture, gateway: MetaGateway, now: () => Date = () => new Date()): Promise<WorkflowResult> {
  const { accepted, rejected } = ingestUTRows(fx.ut_rows, fx.register);
  const locations = [...new Set(fx.register.map((l) => l.location_id))].sort();

  const findings: Finding[] = [];
  const gaps: string[] = [];
  const trends: TrendAssessment[] = [];
  let next: InspectionProposal["proposed_next_inspection"];

  for (const loc of locations) {
    const limit = fx.limits.find((l) => l.asset.location_id === loc);
    const decisions = fx.comparability_decisions.filter((d) => d.location_id === loc);
    const t = assessTrend(loc, accepted, fx.rate_policy, { limit, decisions });
    trends.push(t);
    const readingRefs = accepted.filter((r) => r.asset.location_id === loc).map((r) => ref("ut_reading", r.id));

    if (t.status === "refused") {
      gaps.push(`${loc}: trend refused — ${t.reasons.map((r) => `${r.reason} (${r.detail})`).join("; ")}`);
      continue;
    }
    const ev = [...readingRefs, ...decisions.map((d) => ref("comparability_decision", d.id)), ref("rate_policy", fx.rate_policy.id)];
    const lt = t.long_term.status === "rate" ? `${fmt(t.long_term.rate_mm_per_year)} mm/y` : t.long_term.status;
    const st = t.short_term.status === "rate" ? `${fmt(t.short_term.rate_mm_per_year)} mm/y` : t.short_term.status;
    const gain = [t.long_term, t.short_term].find((r) => r.status === "thickness_gain");
    if (gain && gain.status === "thickness_gain") {
      gaps.push(`${loc}: wall gain ${fmt(-gain.change_mm)} mm (${gain.from_id} → ${gain.to_id}) beyond uncertainty ${fmt(gain.combined_uncertainty_mm)} mm — indeterminate, engineer review`);
    }
    if (t.governing.rate_mm_per_year === null && gain) {
      findings.push({ text: `${loc}: no positive wall-loss rate beyond uncertainty (long-term ${lt}, short-term ${st}); wall gain is indeterminate, not a corrosion rate; latest ${t.latest.thickness_mm} mm.`, evidence: ev, basis: "derived" });
    } else if (t.governing.rate_mm_per_year === null) {
      findings.push({ text: `${loc}: no wall loss exceeding combined measurement uncertainty (long-term ${lt}, short-term ${st}); latest ${t.latest.thickness_mm} mm.`, evidence: ev, basis: "derived" });
    } else {
      findings.push({ text: `${loc}: governing corrosion rate ${fmt(t.governing.rate_mm_per_year)} mm/y (${t.governing.selected}; long-term ${lt}, short-term ${st}) under ${t.governing.policy_id}; latest ${t.latest.thickness_mm} mm.`, evidence: ev, basis: "derived" });
    }
    const th = t.threshold;
    if (th.status === "at_or_below_t_min") {
      findings.push({ text: `${loc}: latest thickness ${th.latest_mm} mm is at or below t_min ${th.t_min_mm} mm — exceeded-threshold state; immediate engineering review required.`, evidence: [...ev, ref("engineer_limit", th.limit_id)], basis: "derived" });
    } else if (th.status === "above_t_min" && th.remaining_life_years !== null) {
      findings.push({ text: `${loc}: remaining life ${fmt(th.remaining_life_years)} y to t_min ${th.t_min_mm} mm ${th.note}.`, evidence: [...ev, ref("engineer_limit", th.limit_id)], basis: "derived" });
      if (t.next_inspection_due && (!next || t.next_inspection_due < next.due_by)) {
        next = {
          method: "UT-A-scan per PROC-UT-01 (same procedure as trend basis)",
          due_by: t.next_inspection_due,
          rationale: `${loc}: min(${fx.rate_policy.interval_fraction_of_remaining_life} × remaining life, ${fx.rate_policy.max_interval_years} y) under ${fx.rate_policy.id}`,
          evidence: [...ev, ref("engineer_limit", th.limit_id)],
        };
      }
    } else if (th.status === "no_limit") {
      gaps.push(`${loc}: no engineer-entered t_min — remaining life not computed`);
    } else if (th.status === "limit_not_approved" || th.status === "limit_invalid") {
      gaps.push(`${loc}: t_min ${th.limit_id} is ${th.status} — remaining life not computed`);
    }
  }

  for (const r of rejected) gaps.push(`rejected record ${r.record_id}: ${r.reasons.map((x) => x.reason).join(", ")}`);
  for (const p of fx.process_samples) {
    if (p.quality !== "good" || p.value === null) gaps.push(`process ${p.pi_tag} at ${p.provenance.event_time}: ${p.quality} (no value; not zero-filled)`);
  }
  for (const e of fx.sensor_events) {
    if (e.event_type === "connectivity_lost") gaps.push(`sensor ${e.sensor_id} (${e.location_id}) connectivity lost at ${e.event_time}; health events never substitute for readings`);
  }

  const at = now().toISOString();
  const origins = [...new Set([...accepted.map((r) => r.provenance.origin), ...fx.process_samples.map((p) => p.provenance.origin)])];
  const proposal: InspectionProposal = {
    kind: "inspection_proposal",
    id: `PROP-${fx.asset.circuit}-${fx.asset.asset_tag}`,
    asset: fx.asset,
    summary: `${fx.asset.circuit}/${fx.asset.asset_tag}: ${findings.length} evidence-linked finding(s), ${gaps.length} data gap(s). Data origin: ${origins.join(", ")}.`,
    findings,
    data_gaps: gaps,
    proposed_next_inspection: next,
    status: "draft",
    provenance: { source_system: "integrity-copilot", source_ref: "workflow.runReplay", origin: origins.includes("live") && origins.length === 1 ? "live" : origins.includes("synthetic") ? "synthetic" : "replay", basis: "derived", event_time: at, ingested_at: at },
  };
  const proposal_errors = validateProposal(proposal, evidenceIndex(fx, accepted));

  // Optional Meta narrative over the deterministic findings only.
  const cited = [...new Set(findings.flatMap((f) => f.evidence.map((e) => e.record_id)))];
  // The model never sees a value or a digit: identifiers become digit-free aliases (CML#a) and every
  // number becomes "[value]". Real identifiers are restored only after the numeric guard passes.
  const { masked: source, aliases } = prepareModelInput(JSON.stringify({ findings: findings.map((f) => f.text), data_gaps: gaps, next_inspection: next ?? null, data_origin: origins }));
  const res = await gateway.respond({
    model: gateway.narrativeModel,
    evidence_ids: cited,
    // Muse reasons before answering: live runs hit 600 and 2048 (C-009, C-011); 1497 out / 1111 reasoning at 4096.
    max_output_tokens: 4096,
    input: [
      {
        role: "system",
        content:
          "You summarise piping-integrity findings for a qualified engineer. Use ONLY the findings and gaps provided. Values are shown as [value]; never guess them. Write NO numbers of any kind: no digits, number words, dates, percentages, fractions or measurements. Refer to values qualitatively instead (for example 'the governing short-term rate', 'the remaining life', 'the next inspection date'); the engineer sees the exact values beside your text. Name locations, procedures and records only by their identifiers exactly as given (for example CML#a), never as quantities. Do not approve anything. Write at most three plain sentences in English, then the same in Portuguese.",
      },
      { role: "user", content: source },
    ],
  });
  // The narrative must carry no numbers at all (C-010 review): any numeric content withholds it.
  const unfaithful = res.status === "ok" ? numericContent(res.text, aliases) : [];
  const meta_summary: MetaSummary =
    res.status !== "ok"
      ? { status: res.status, reason: res.reason, detail: res.detail }
      : unfaithful.length
        ? { status: "error", reason: "unfaithful", detail: `summary withheld: the narrative must contain no numbers, found ${unfaithful.map((u) => JSON.stringify(u)).join(", ")}` }
        : { status: "ok", text: restoreAliases(res.text, aliases), model_id: res.model_id, call_id: res.call_id, basis: "model_inferred" };

  return {
    data_label: fx._label,
    origins,
    asset: fx.asset,
    framework_state: gaps.length || trends.some((t) => t.status === "assessed" && t.threshold.status === "at_or_below_t_min") ? "exception_open" : "monitoring",
    accepted_ut: accepted,
    rejected,
    trends,
    process_samples: fx.process_samples,
    sensor_events: fx.sensor_events,
    data_gaps: gaps,
    proposal,
    proposal_errors,
    meta_summary,
    usage: gateway.usage,
  };
}

// Server-side engineer decision. decided_at is the server clock, never client-supplied.
export function decideProposal(
  proposal: InspectionProposal,
  known: Map<string, AssetNode>,
  input: { engineer: unknown; rationale: unknown; decision: unknown },
  now: () => Date = () => new Date()
): { proposal: InspectionProposal } | { errors: string[] } {
  if (proposal.status !== "draft") return { errors: [`proposal is already ${proposal.status}`] };
  if (input.decision !== "approved" && input.decision !== "rejected") return { errors: ['decision must be "approved" or "rejected"'] };
  const engineer = typeof input.engineer === "string" ? input.engineer.trim() : "";
  const rationale = typeof input.rationale === "string" ? input.rationale.trim() : "";
  const decided = { ...proposal, status: input.decision, approval: { engineer, rationale, decided_at: now().toISOString() } } as InspectionProposal;
  const errors = validateProposal(decided, known);
  if (!isValidTimestamp(decided.approval!.decided_at)) errors.push("server clock produced an invalid timestamp");
  return errors.length ? { errors } : { proposal: decided };
}

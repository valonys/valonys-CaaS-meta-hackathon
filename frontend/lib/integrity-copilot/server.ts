// Server-side helpers for the Integrity Copilot API routes. Imports nothing from legacy lib/.

import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fixtureJson from "./fixtures/synthetic-circuit.json";
import samRecorded from "./fixtures/sam-recorded.json";
import portfolioJson from "./fixtures/synthetic-portfolio.json";
import { workbookToLines, type LineInfo, type LinePlan, type Portfolio, type VisualFinding } from "./workbook.ts";
import { rankNextSpots, type NextSpot } from "./nextspots.ts";
import { UploadStore, validateUpload, type CampaignForm, type ComparabilityForm, type UploadOutcome } from "./uploads.ts";
import { visualEvidence, type VisualEvidence } from "./visual.ts";
import { installEgressAllowlist } from "./egress.ts";

// Network boundary for the whole server process: only the Meta API and loopback local Muse.
installEgressAllowlist();
import { gatewayFromEnv, ledgerFromEnv, ResponseCache, type BudgetLedger } from "./gateway.ts";
import { decideProposal, evidenceIndex, runReplay, type CircuitFixture, type WorkflowResult } from "./workflow.ts";
import { decisionStoreFromEnv, type DecisionStore } from "./decision-store.ts";

export const fixture = fixtureJson as unknown as CircuitFixture;

// One Meta spend ledger for the whole server process, so per-request gateways cannot reset the
// call/USD ceilings. Pinned on globalThis so Next dev hot-reload does not mint a fresh one.
const g = globalThis as typeof globalThis & { __integrityCopilotLedger?: BudgetLedger; __integrityCopilotDecisions?: DecisionStore; __integrityCopilotCache?: ResponseCache };
export function processLedger(): BudgetLedger {
  return (g.__integrityCopilotLedger ??= ledgerFromEnv());
}

// One validated-response cache per process: repeat replays of the same masked input spend nothing.
export function processCache(): ResponseCache {
  return (g.__integrityCopilotCache ??= new ResponseCache());
}

// Durable engineer decisions (file-backed, survives restarts), one store per process.
export function processDecisions(): DecisionStore {
  return (g.__integrityCopilotDecisions ??= decisionStoreFromEnv());
}

export type Gate = { ok: true } | { ok: false; status: 401 | 503; error: string };

// Fail closed: without a configured token, protected actions are unavailable rather than open.
export function checkApproverToken(header: string | null, env = process.env): Gate {
  const expected = env.INTEGRITY_COPILOT_APPROVER_TOKEN;
  if (!expected) return { ok: false, status: 503, error: "approval_not_configured: set INTEGRITY_COPILOT_APPROVER_TOKEN on the server" };
  const a = Buffer.from(header ?? "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, status: 401, error: "invalid approver token" };
  return { ok: true };
}

export type ReplayResult = WorkflowResult & { visual: VisualEvidence | null; line: LineInfo; findings: VisualFinding[] };

// Lines available to the workbench: the original PC-01 circuit (kept as the default) plus the
// synthetic Inspection Workbook portfolio. All synthetic; real reports never enter the app.
const portfolio = portfolioJson as unknown as Portfolio;
const legacyPlan: LinePlan = {
  line: {
    tag: fixture.asset.asset_tag,
    line_number: fixture.asset.circuit,
    unit: fixture.asset.unit,
    description: "Original one-circuit replay (synthetic)",
    fluid: "n/a (synthetic)",
    criticality: "n/a",
    design_p_bar: 0,
    oper_p_bar: 0,
    design_t_c: 0,
    oper_t_c: 0,
    material: "n/a",
    pid: "n/a",
    cmls: fixture.register.map((r) => ({ id: r.location_id, description: r.location_description, active_from: r.active_from })),
  },
  fixture,
  findings: [],
};
// Uploaded campaigns (durable, data dir) are merged into the workbook portfolio on every request.
const gu = globalThis as typeof globalThis & { __integrityCopilotUploads?: UploadStore };
const uploadStore = (): UploadStore => (gu.__integrityCopilotUploads ??= new UploadStore(process.env.INTEGRITY_COPILOT_DATA_DIR || ".data"));
// Temporal contract: the ranking is a snapshot "as of" the later of the portfolio date and the most
// recent import. Imports cannot be dated in the future and their decisions are made at import time,
// so nothing is later than the snapshot; the filter below enforces that independently.
export function snapshotAsOf(): string {
  const times = [portfolio.as_of, ...uploadStore().all.map((u) => u.uploaded_at)].map((t) => Date.parse(t));
  return new Date(Math.max(...times)).toISOString();
}

function currentPlans(asOf: string = snapshotAsOf()): LinePlan[] {
  const limit = Date.parse(asOf);
  const ups = uploadStore().all;
  const notAfter = (t: string) => Date.parse(t) <= limit;
  const merged: Portfolio = {
    ...portfolio,
    // An engineer t_min entered after the snapshot does not apply to it either.
    lines: portfolio.lines.map((l) => ({ ...l, cmls: l.cmls.map((c) => (c.t_min && !notAfter(c.t_min.entered_at) ? { ...c, t_min: undefined } : c)) })),
    // Uploaded campaigns are recorded data (origin "replay"); the label must say they are included.
    _label: ups.length ? `${portfolio._label} Includes ${ups.length} uploaded campaign(s) (origin: replay, recorded data).` : portfolio._label,
    campaigns: [...portfolio.campaigns, ...ups.map((u) => u.campaign)].filter((c) => notAfter(`${c.read_date}T00:00:00Z`)),
    comparability_decisions: [...portfolio.comparability_decisions, ...ups.flatMap((u) => u.decisions)].filter((d) => notAfter(d.decided_at)),
  };
  return [legacyPlan, ...workbookToLines(merged)];
}
const planFor = (tag?: string | null) => (tag ? currentPlans().find((p) => p.line.tag === tag) : legacyPlan);

// Validate and store one uploaded campaign (CSV in workbook layout + engineer campaign metadata).
export function uploadCampaign(csv: unknown, form: CampaignForm, comparability?: ComparabilityForm): UploadOutcome {
  const plans = currentPlans().filter((p) => p !== legacyPlan);
  const knownWorkOrders = new Set([...portfolio.campaigns, ...uploadStore().all.map((u) => u.campaign)].map((c) => c.work_order));
  const existingReadingIds = (tag: string, loc: string) =>
    plans.find((p) => p.line.tag === tag)?.fixture.ut_rows.filter((r) => r.location_id === loc).map((r) => String(r.record_id)) ?? [];
  const { outcome, stored } = validateUpload(csv, form, comparability, { plant: portfolio.plant, lines: plans.map((p) => p.line), knownWorkOrders, existingReadingIds, now: new Date() });
  if (stored) uploadStore().add(stored);
  return outcome;
}

export interface PortfolioView {
  label: string;
  as_of: string;
  lines: LineInfo[];
  spots: NextSpot[];
}

// Deterministic Next-spots ranking across the workbook portfolio lines (the legacy PC-01 circuit
// is the default single-line replay only, not part of the portfolio). Never calls a model.
export async function portfolioView(): Promise<PortfolioView> {
  const offline = gatewayFromEnv({ INTEGRITY_COPILOT_LIVE: "0" });
  const results = [];
  const asOf = snapshotAsOf();
  const plans = currentPlans(asOf).filter((p) => p !== legacyPlan);
  for (const plan of plans) {
    const r = await runReplay(plan.fixture, offline, () => new Date(asOf));
    results.push({ line: plan.line, trends: r.trends, findings: plan.findings, sensor_events: plan.fixture.sensor_events });
  }
  const n = uploadStore().all.length;
  const label = n ? `${portfolio._label} Includes ${n} uploaded campaign(s) (origin: replay, recorded data).` : portfolio._label;
  return { label, as_of: asOf, lines: plans.map((p) => p.line), spots: rankNextSpots(results, asOf) };
}

// The synthetic inspection image (drawn for the demo, no client media) and its recorded SAM output.
const IMAGE_SRC = "/evidence/synthetic-pipe.png";
let imageDataUrl: string | undefined;
function visualSource() {
  imageDataUrl ??= "data:image/png;base64," + readFileSync(join(process.cwd(), "public", IMAGE_SRC)).toString("base64");
  return { image_src: IMAGE_SRC, image_ref: samRecorded.image_ref, image_data_url: imageDataUrl, prompt: samRecorded.prompt, recorded: { output: samRecorded.output, recorded_at: samRecorded.recorded_at } };
}

export class UnknownLineError extends Error {}

export async function replay(lineTag?: string | null): Promise<ReplayResult> {
  const plan = planFor(lineTag);
  if (!plan) throw new UnknownLineError(`unknown line "${String(lineTag)}"`);
  const gateway = gatewayFromEnv(process.env, processLedger(), processCache());
  const result = await runReplay(plan.fixture, gateway);
  // Image evidence exists only where the portfolio records one (synthetic image, recorded SAM output).
  const hasImage = plan === legacyPlan || portfolio.images.some((i) => i.tag === plan.line.tag);
  const visual = hasImage ? await visualEvidence(gateway, visualSource()) : null;
  const decided = processDecisions().get(result.proposal.id);
  return { ...(decided ? { ...result, proposal: decided } : result), visual, usage: gateway.usage, line: plan.line, findings: plan.findings };
}

export async function decide(input: { proposal_id: unknown; engineer: unknown; rationale: unknown; decision: unknown }) {
  const decisions = processDecisions();
  if (decisions.has(String(input.proposal_id))) return { errors: ["proposal already decided"] };
  for (const plan of currentPlans()) {
    const base = await runReplay(plan.fixture, gatewayFromEnv({ ...process.env, INTEGRITY_COPILOT_LIVE: "0" }));
    if (input.proposal_id !== base.proposal.id) continue;
    const out = decideProposal(base.proposal, evidenceIndex(plan.fixture, base.accepted_ut), input);
    if ("proposal" in out) decisions.put(out.proposal);
    return out;
  }
  return { errors: [`unknown proposal_id "${String(input.proposal_id)}"`] };
}

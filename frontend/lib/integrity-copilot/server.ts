// Server-side helpers for the Integrity Copilot API routes. Imports nothing from legacy lib/.

import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fixtureJson from "./fixtures/synthetic-circuit.json";
import samRecorded from "./fixtures/sam-recorded.json";
import { visualEvidence, type VisualEvidence } from "./visual.ts";
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

export type ReplayResult = WorkflowResult & { visual: VisualEvidence };

// The synthetic inspection image (drawn for the demo, no client media) and its recorded SAM output.
const IMAGE_SRC = "/evidence/synthetic-pipe.png";
let imageDataUrl: string | undefined;
function visualSource() {
  imageDataUrl ??= "data:image/png;base64," + readFileSync(join(process.cwd(), "public", IMAGE_SRC)).toString("base64");
  return { image_src: IMAGE_SRC, image_ref: samRecorded.image_ref, image_data_url: imageDataUrl, prompt: samRecorded.prompt, recorded: { output: samRecorded.output, recorded_at: samRecorded.recorded_at } };
}

export async function replay(): Promise<ReplayResult> {
  const gateway = gatewayFromEnv(process.env, processLedger(), processCache());
  const result = await runReplay(fixture, gateway);
  const visual = await visualEvidence(gateway, visualSource());
  const decided = processDecisions().get(result.proposal.id);
  return { ...(decided ? { ...result, proposal: decided } : result), visual, usage: gateway.usage };
}

export async function decide(input: { proposal_id: unknown; engineer: unknown; rationale: unknown; decision: unknown }) {
  const decisions = processDecisions();
  if (decisions.has(String(input.proposal_id))) return { errors: ["proposal already decided"] };
  const base = await runReplay(fixture, gatewayFromEnv({ ...process.env, INTEGRITY_COPILOT_LIVE: "0" }));
  if (input.proposal_id !== base.proposal.id) return { errors: [`unknown proposal_id "${String(input.proposal_id)}"`] };
  const out = decideProposal(base.proposal, evidenceIndex(fixture, base.accepted_ut), input);
  if ("proposal" in out) decisions.put(out.proposal);
  return out;
}

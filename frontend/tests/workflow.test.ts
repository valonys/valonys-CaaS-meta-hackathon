// framework/ADOPTION.md "Initial shared acceptance scenario" on the synthetic fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MetaGateway } from "../lib/integrity-copilot/gateway.ts";
import { runReplay, decideProposal, evidenceIndex, type CircuitFixture } from "../lib/integrity-copilot/workflow.ts";

const fx = JSON.parse(readFileSync(new URL("../lib/integrity-copilot/fixtures/synthetic-circuit.json", import.meta.url), "utf8")) as CircuitFixture;
const NOW = () => new Date("2026-10-29T09:00:00Z");

test("Meta unavailable: deterministic result complete, explicit unavailable state, zero network", async () => {
  const r = await runReplay(fx, new MetaGateway({}), NOW);
  assert.equal(r.meta_summary.status, "unavailable");
  assert.equal(r.usage.length, 1);
  assert.deepEqual(r.origins, ["synthetic"]);
  assert.equal(r.proposal.provenance.origin, "synthetic");
  assert.deepEqual(r.proposal_errors, []);

  const byLoc = Object.fromEntries(r.trends.map((t) => [t.location_id, t]));
  const t3 = byLoc["CML-03"];
  assert.ok(t3.status === "assessed" && t3.governing.rate_mm_per_year === 0.1875 && t3.threshold.status === "above_t_min" && t3.threshold.remaining_life_years === 16);
  assert.ok(byLoc["CML-04"].status === "refused" && byLoc["CML-04"].reasons.some((x) => x.reason === "procedure_mismatch"));
  assert.ok(byLoc["CML-05"].status === "assessed" && byLoc["CML-05"].long_term.status === "within_uncertainty");
  assert.ok(byLoc["CML-06"].status === "refused" && byLoc["CML-06"].reasons[0].reason === "insufficient_history");

  assert.equal(r.proposal.proposed_next_inspection?.due_by, "2032-01-01T00:00:00.000Z");
  assert.equal(r.framework_state, "exception_open");
});

test("rejected rows keep reason codes; photo-derived thickness never accepted", async () => {
  const r = await runReplay(fx, new MetaGateway({}), NOW);
  const reasons = Object.fromEntries(r.rejected.map((x) => [x.record_id, x.reasons.map((y) => y.reason)]));
  assert.ok(reasons["BAD-PHOTO"].includes("basis_not_measured"));
  assert.ok(reasons["BAD-UNIT"].includes("unit_unsupported"));
  assert.ok(reasons["BAD-DATE"].includes("timestamp_invalid"));
  assert.ok(reasons["BAD-CML"].includes("location_unknown"));
  assert.ok(!r.accepted_ut.some((u) => u.id.startsWith("BAD-")));
});

test("data gaps: missing PI value not zero-filled, sensor outage, no t_min", async () => {
  const r = await runReplay(fx, new MetaGateway({}), NOW);
  assert.ok(r.data_gaps.some((g) => /TI-101.*missing.*not zero-filled/.test(g)));
  assert.ok(r.data_gaps.some((g) => /WUT-03.*connectivity lost/.test(g)));
  assert.ok(r.data_gaps.some((g) => /CML-05: no engineer-entered t_min/.test(g)));
});

test("every finding cites in-scope evidence; no background-research media is cited", async () => {
  const r = await runReplay(fx, new MetaGateway({}), NOW);
  const cited = r.proposal.findings.flatMap((f) => f.evidence.map((e) => e.record_id));
  assert.ok(cited.length > 0);
  assert.ok(!cited.some((id) => /timeline_|wireless-ut|poster|proposal/i.test(id)));
  assert.ok(r.proposal.findings.every((f) => f.basis === "derived"));
});

test("live Meta summary is labelled model_inferred and changes no deterministic output", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ model: "muse-spark-1.3", output_text: "EN … / PT …", usage: { input_tokens: 900, output_tokens: 200 } }), { status: 200 })) as unknown as typeof fetch;
  const live = await runReplay(fx, new MetaGateway({ apiKey: "k", fetchImpl, narrativeModel: "muse-spark-1.3" }), NOW);
  const off = await runReplay(fx, new MetaGateway({}), NOW);
  assert.ok(live.meta_summary.status === "ok" && live.meta_summary.basis === "model_inferred" && live.meta_summary.model_id === "muse-spark-1.3");
  assert.deepEqual(live.proposal, off.proposal);
  assert.deepEqual(live.trends, off.trends);
});

test("engineer decision: server-side, named, rationale required, single use", async () => {
  const r = await runReplay(fx, new MetaGateway({}), NOW);
  const known = evidenceIndex(fx, r.accepted_ut);
  const bad = decideProposal(r.proposal, known, { engineer: " ", rationale: "", decision: "approved" }, NOW);
  assert.ok("errors" in bad && bad.errors.some((e) => /named engineer/.test(e)) && bad.errors.some((e) => /rationale/.test(e)));
  assert.ok("errors" in decideProposal(r.proposal, known, { engineer: "A", rationale: "B", decision: "maybe" }, NOW));
  const ok = decideProposal(r.proposal, known, { engineer: "J. Engineer", rationale: "Agree with ST governing rate; schedule UT.", decision: "approved" }, NOW);
  assert.ok("proposal" in ok && ok.proposal.status === "approved" && ok.proposal.approval?.decided_at === "2026-10-29T09:00:00.000Z");
  if ("proposal" in ok) assert.ok("errors" in decideProposal(ok.proposal, known, { engineer: "X", rationale: "Y", decision: "rejected" }, NOW));
  assert.equal(r.proposal.status, "draft"); // original untouched
});

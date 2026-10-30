import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileDecisionStore } from "../lib/integrity-copilot/decision-store.ts";
import type { InspectionProposal } from "../lib/integrity-copilot/evidence.ts";

const decided = (id: string) =>
  ({ id, status: "approved", approval: { engineer: "J. Engineer", rationale: "ok", decided_at: "2026-10-30T09:00:00.000Z" } }) as unknown as InspectionProposal;
const tmp = () => mkdtempSync(join(tmpdir(), "icp-store-"));
const storeWith = (decisions: unknown, audit: unknown = []) => {
  const dir = tmp();
  writeFileSync(join(dir, "decisions.json"), JSON.stringify({ version: 1, decisions, audit }));
  return dir;
};

test("decision store: survives a restart, stays single use, audit committed with the decision", () => {
  const dir = tmp();
  const a = new FileDecisionStore(dir);
  a.put(decided("P-1"));
  assert.throws(() => a.put(decided("P-1")), /already decided/);

  const b = new FileDecisionStore(dir); // simulated restart
  assert.equal(b.get("P-1")?.status, "approved");
  assert.throws(() => b.put(decided("P-1")), /already decided/);
  assert.equal(b.auditTrail.length, 1);
  assert.equal(b.auditTrail[0].engineer, "J. Engineer");
});

test("decision store: a failed write commits nothing, in memory or on disk (C-006 P1-1)", { skip: process.getuid?.() === 0 }, () => {
  const dir = tmp();
  const s = new FileDecisionStore(dir);
  chmodSync(dir, 0o500); // directory not writable: tmp write fails
  try {
    assert.throws(() => s.put(decided("P-1")));
  } finally {
    chmodSync(dir, 0o700);
  }
  assert.equal(s.has("P-1"), false);
  assert.equal(new FileDecisionStore(dir).has("P-1"), false);
  s.put(decided("P-1")); // and the proposal is still decidable
  assert.equal(JSON.parse(readFileSync(join(dir, "decisions.json"), "utf8")).audit.length, 1);
});

test("decision store: malformed records refuse to load instead of locking a proposal (C-006 P1-2)", () => {
  const audit = [{ at: "2026-10-30T09:00:00.000Z", proposal_id: "P-1", status: "approved", engineer: "J", decided_at: "2026-10-30T09:00:00.000Z" }];
  const bad: [unknown, unknown, RegExp][] = [
    [{ "P-1": null }, audit, /not an object/],
    [{ "P-1": { ...decided("P-2") } }, audit, /does not match key/],
    [{ "P-1": { ...decided("P-1"), status: "draft" } }, audit, /not a decision/],
    [{ "P-1": { ...decided("P-1"), approval: { engineer: " ", rationale: "r", decided_at: "x" } } }, audit, /approval needs/],
    [{ "P-1": decided("P-1") }, [], /no audit record/],
  ];
  for (const [decisions, a, re] of bad) assert.throws(() => new FileDecisionStore(storeWith(decisions, a)), re);
  for (const root of ["[]", "{}", '{"version":1,"decisions":[],"audit":[]}']) {
    const dir = tmp();
    writeFileSync(join(dir, "decisions.json"), root);
    assert.throws(() => new FileDecisionStore(dir), /corrupt decision store/);
  }
  assert.throws(() => new FileDecisionStore(tmp()).put({ ...decided("P-9"), status: "draft" } as InspectionProposal), /refusing to store/);
});

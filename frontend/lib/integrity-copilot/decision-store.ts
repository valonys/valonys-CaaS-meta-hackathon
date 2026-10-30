// Durable engineer-decision store for the Integrity Copilot.
//
// - One JSON file in the data dir (INTEGRITY_COPILOT_DATA_DIR, default ./.data) holds both the
//   decisions and their audit trail, written with one atomic tmp + rename. A decision and its
//   audit record therefore commit together or not at all, and a failed write leaves memory unchanged.
// - Every stored record is validated on load. Anything malformed refuses to start, rather than
//   starting empty or locking a proposal behind an invalid record.
// - Single use survives restarts: a proposal decided before a restart stays decided.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { InspectionProposal } from "./evidence.ts";

export interface DecisionStore {
  get(id: string): InspectionProposal | undefined;
  has(id: string): boolean;
  put(p: InspectionProposal): void;
}

export interface AuditRecord {
  at: string;
  proposal_id: string;
  status: "approved" | "rejected";
  engineer: string;
  decided_at: string;
}

interface StoreFile {
  version: 1;
  decisions: Record<string, InspectionProposal>;
  audit: AuditRecord[];
}

const isIso = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));
const nonEmpty = (v: unknown) => typeof v === "string" && v.trim().length > 0;

// Returns the problem with a stored decision, or null if it is a well-formed decided proposal.
export function decidedRecordProblem(id: string, p: unknown): string | null {
  if (!p || typeof p !== "object" || Array.isArray(p)) return "not an object";
  const r = p as Partial<InspectionProposal>;
  if (r.id !== id) return `id "${String(r.id)}" does not match key`;
  if (r.status !== "approved" && r.status !== "rejected") return `status "${String(r.status)}" is not a decision`;
  const a = r.approval;
  if (!a || !nonEmpty(a.engineer) || !nonEmpty(a.rationale) || !isIso(a.decided_at)) return "approval needs engineer, rationale and a valid decided_at";
  return null;
}

function parseStore(raw: unknown, file: string): StoreFile {
  const fail = (why: string): never => {
    throw new Error(`corrupt decision store ${file}: ${why}`);
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("root is not an object");
  const s = raw as Partial<StoreFile>;
  if (s.version !== 1) fail(`unsupported version ${String(s.version)}`);
  if (!s.decisions || typeof s.decisions !== "object" || Array.isArray(s.decisions)) fail("decisions is not an object");
  if (!Array.isArray(s.audit)) fail("audit is not an array");
  for (const [id, p] of Object.entries(s.decisions!)) {
    const problem = decidedRecordProblem(id, p);
    if (problem) fail(`decision "${id}": ${problem}`);
  }
  for (const id of Object.keys(s.decisions!)) if (!s.audit!.some((e) => e?.proposal_id === id)) fail(`decision "${id}" has no audit record`);
  return s as StoreFile;
}

export class MemoryDecisionStore implements DecisionStore {
  private m = new Map<string, InspectionProposal>();
  get(id: string) {
    return this.m.get(id);
  }
  has(id: string) {
    return this.m.has(id);
  }
  put(p: InspectionProposal) {
    const problem = decidedRecordProblem(p.id, p);
    if (problem) throw new Error(`refusing to store decision "${p.id}": ${problem}`);
    if (this.m.has(p.id)) throw new Error(`proposal already decided: ${p.id}`);
    this.m.set(p.id, p);
  }
}

export class FileDecisionStore implements DecisionStore {
  readonly file: string;
  private state: StoreFile;

  constructor(dir: string) {
    const root = resolve(dir);
    mkdirSync(root, { recursive: true });
    this.file = join(root, "decisions.json");
    this.state = existsSync(this.file)
      ? parseStore(JSON.parse(readFileSync(this.file, "utf8")) as unknown, this.file)
      : { version: 1, decisions: {}, audit: [] };
  }

  get(id: string) {
    return Object.hasOwn(this.state.decisions, id) ? this.state.decisions[id] : undefined;
  }
  has(id: string) {
    return Object.hasOwn(this.state.decisions, id);
  }
  get auditTrail(): readonly AuditRecord[] {
    return this.state.audit;
  }

  put(p: InspectionProposal) {
    const problem = decidedRecordProblem(p.id, p);
    if (problem) throw new Error(`refusing to store decision "${p.id}": ${problem}`);
    if (this.has(p.id)) throw new Error(`proposal already decided: ${p.id}`);
    const entry: AuditRecord = {
      at: new Date().toISOString(),
      proposal_id: p.id,
      status: p.status as AuditRecord["status"],
      engineer: p.approval!.engineer,
      decided_at: p.approval!.decided_at,
    };
    const next: StoreFile = { version: 1, decisions: { ...this.state.decisions, [p.id]: p }, audit: [...this.state.audit, entry] };
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2));
    renameSync(tmp, this.file); // the only commit point; memory changes only after it succeeds
    this.state = next;
  }
}

export function decisionStoreFromEnv(env: Record<string, string | undefined> = process.env): DecisionStore {
  return new FileDecisionStore(env.INTEGRITY_COPILOT_DATA_DIR || ".data");
}

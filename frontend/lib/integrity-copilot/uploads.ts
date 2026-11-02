// CSV upload of one inspection campaign in Inspection Workbook layout.
//
// - Headers (case-insensitive): Tag/Equipment, Position, Class, Point Description, UoM,
//   Quant Reading, Qual Reading, Comment / Text. Campaign-level fields come from the form.
// - UT campaigns need engineer-entered procedure, revision, instrument, calibration and uncertainty.
// - Rows must reference a registered line; UT rows must name one of its CMLs with a positive reading;
//   visual rows must carry a valuation code. Every rejected row is reported with its reason.
// - Comparability is an explicit engineer act: if a name and rationale are given, one decision per
//   CML covers the existing readings plus the new ones. Without it, the engine may refuse the trend.
// - Accepted campaigns are stored atomically in the data dir, labelled origin "replay".

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ComparabilityDecision } from "./evidence.ts";
import { parseCsv } from "./csv.ts";
import { parseQualReading } from "./codes.ts";
import { lineRegister, toRawUTRow, type Campaign, type LineInfo, type WorkbookRow } from "./workbook.ts";
import { ingestUTRows } from "./ut-adapter.ts";

export interface CampaignForm {
  work_order: unknown;
  technique: unknown;
  read_date: unknown;
  performer: unknown;
  procedure_id?: unknown;
  procedure_revision?: unknown;
  instrument_id?: unknown;
  calibration_ref?: unknown;
  measurement_uncertainty_mm?: unknown;
  quality?: unknown; // engineer attestation for UT readings: good | suspect | bad | stale | missing
}

const QUALITIES = ["good", "suspect", "bad", "stale", "missing"] as const;

export interface ComparabilityForm {
  decided_by: unknown;
  rationale: unknown;
}

export interface StoredUpload {
  campaign: Campaign;
  decisions: ComparabilityDecision[];
  uploaded_at: string;
}

export type UploadOutcome =
  | { status: "accepted"; work_order: string; accepted_rows: number; excluded_from_trends: number; rejected: { row: number; reason: string }[]; decisions: number }
  | { status: "rejected"; errors: string[]; rejected: { row: number; reason: string }[] };

const HEADERS = {
  tag: "tag/equipment",
  position: "position",
  class: "class",
  point_description: "point description",
  uom: "uom",
  quant_reading: "quant reading",
  qual_reading: "qual reading",
  comment: "comment / text",
} as const;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const isUT = (technique: string) => /^(UT|WUT)/i.test(technique);

export function validateUpload(
  csv: unknown,
  form: CampaignForm,
  comparability: ComparabilityForm | undefined,
  ctx: { plant: string; lines: LineInfo[]; knownWorkOrders: Set<string>; existingReadingIds: (tag: string, loc: string) => string[]; now: Date }
): { outcome: UploadOutcome; stored?: StoredUpload } {
  const errors: string[] = [];
  const work_order = text(form.work_order);
  const technique = text(form.technique);
  const read_date = text(form.read_date);
  const performer = text(form.performer);
  if (!/^[A-Za-z0-9-]{1,20}$/.test(work_order)) errors.push("work order must be 1-20 letters, digits or dashes");
  else if (ctx.knownWorkOrders.has(work_order)) errors.push(`work order ${work_order} is already imported`);
  if (!technique) errors.push("technique (InspTechText) is required");
  // Exact calendar date: must round-trip (2025-02-30 would otherwise normalize to March).
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(read_date) ? new Date(`${read_date}T00:00:00Z`) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== read_date) errors.push("read date must be a real calendar date, YYYY-MM-DD");
  else if (Date.parse(`${read_date}T00:00:00Z`) > ctx.now.getTime()) errors.push("read date is in the future");
  if (!performer) errors.push("performer is required");

  const ut = isUT(technique);
  const meta = {
    procedure_id: text(form.procedure_id),
    procedure_revision: text(form.procedure_revision),
    instrument_id: text(form.instrument_id),
    calibration_ref: text(form.calibration_ref),
    measurement_uncertainty_mm: typeof form.measurement_uncertainty_mm === "number" ? form.measurement_uncertainty_mm : Number(text(form.measurement_uncertainty_mm)),
  };
  if (ut) {
    for (const k of ["procedure_id", "procedure_revision", "instrument_id", "calibration_ref"] as const) if (!meta[k]) errors.push(`UT campaign needs ${k.replace("_", " ")}`);
    if (!(Number.isFinite(meta.measurement_uncertainty_mm) && meta.measurement_uncertainty_mm >= 0)) errors.push("UT campaign needs a non-negative measurement uncertainty (mm)");
    if (!(QUALITIES as readonly string[]).includes(text(form.quality))) errors.push(`UT campaign needs the readings' quality (${QUALITIES.join(" | ")})`);
  }
  const decidedBy = text(comparability?.decided_by);
  const rationale = text(comparability?.rationale);
  if (comparability && (!decidedBy || !rationale)) errors.push("a comparability decision needs both the engineer's name and a rationale");

  const parsed = parseCsv(typeof csv === "string" ? csv : "");
  if (parsed.status === "error") errors.push(`CSV: ${parsed.detail}`);
  if (errors.length || parsed.status === "error") return { outcome: { status: "rejected", errors, rejected: [] } };

  const lower = parsed.header.map((h) => h.toLowerCase());
  const dupHeader = lower.find((h, i) => h && lower.indexOf(h) !== i);
  if (dupHeader) return { outcome: { status: "rejected", errors: [`CSV header "${dupHeader}" appears more than once`], rejected: [] } };
  const col = (name: string) => lower.indexOf(name);
  const idx = Object.fromEntries(Object.entries(HEADERS).map(([k, h]) => [k, col(h)])) as Record<keyof typeof HEADERS, number>;
  if (idx.tag < 0 || idx.position < 0) return { outcome: { status: "rejected", errors: ["CSV needs the columns Tag/Equipment and Position"], rejected: [] } };
  if (ut && idx.quant_reading < 0) return { outcome: { status: "rejected", errors: ["a UT campaign CSV needs a Quant Reading column"], rejected: [] } };
  if (!ut && idx.qual_reading < 0) return { outcome: { status: "rejected", errors: ["a visual campaign CSV needs a Qual Reading column"], rejected: [] } };

  const byTag = new Map(ctx.lines.map((l) => [l.tag, l]));
  const rows: WorkbookRow[] = [];
  const rowNumbers: number[] = [];
  const seenPositions = new Set<string>(); // record identity is WB-<work order>-<position>
  const rejected: { row: number; reason: string }[] = [];
  parsed.rows.forEach((cells, i) => {
    const rowNo = i + 2; // header is row 1
    const cell = (k: keyof typeof HEADERS) => (idx[k] >= 0 ? (cells[idx[k]] ?? "").trim() : "");
    const tag = cell("tag");
    const position = cell("position");
    const line = byTag.get(tag);
    if (!line) return rejected.push({ row: rowNo, reason: `unknown line "${tag}" (register the line first)` });
    if (!position) return rejected.push({ row: rowNo, reason: "position is empty" });
    let quant: number | null = null;
    let qual: string | null = null;
    if (ut) {
      if (!line.cmls.some((c) => c.id === position)) return rejected.push({ row: rowNo, reason: `position "${position}" is not a CML of ${line.line_number}` });
      quant = Number(cell("quant_reading"));
      if (!(cell("quant_reading") && Number.isFinite(quant) && quant > 0)) return rejected.push({ row: rowNo, reason: `quant reading "${cell("quant_reading")}" is not a positive number` });
      if (!cell("uom")) return rejected.push({ row: rowNo, reason: "UoM is empty" });
    } else {
      qual = cell("qual_reading");
      if (!parseQualReading(qual)) return rejected.push({ row: rowNo, reason: `qual reading "${qual}" has no valuation code` });
    }
    if (seenPositions.has(position)) return rejected.push({ row: rowNo, reason: `position "${position}" appears more than once in this campaign` });
    seenPositions.add(position);
    rows.push({ tag, position, class: cell("class"), point_description: cell("point_description"), uom: cell("uom"), quant_reading: quant, qual_reading: qual, comment: cell("comment") });
    rowNumbers.push(rowNo);
  });

  const nowIso = ctx.now.toISOString();
  const campaign: Campaign = { work_order, technique, read_date, performer, rows, origin: "replay", ingested_at: nowIso, ...(ut ? { ...meta, quality: text(form.quality) as Campaign["quality"] } : {}) };

  // Acceptance parity: every UT row must pass the same adapter and validator the engine uses
  // (units, calendar, register interval, identity, uncertainty, provenance). Rejections map back
  // to their CSV rows, so a row reported as accepted is a row the engine accepts.
  let excluded = 0;
  if (ut) {
    const keep: boolean[] = rows.map(() => true);
    for (const line of ctx.lines) {
      const idxs = rows.map((r, i) => (r.tag === line.tag ? i : -1)).filter((i) => i >= 0);
      if (!idxs.length) continue;
      const raws = idxs.map((i) => toRawUTRow(ctx.plant, line, campaign, rows[i], nowIso));
      const res = ingestUTRows(raws, lineRegister(ctx.plant, line));
      for (const rj of res.rejected) {
        const k = idxs[raws.findIndex((r) => r.record_id === rj.record_id)];
        if (k === undefined) continue;
        keep[k] = false;
        rejected.push({ row: rowNumbers[k], reason: rj.reasons.map((x) => `${x.reason}: ${x.detail}`).join("; ") });
      }
      excluded += res.accepted.filter((r) => r.quality !== "good").length;
    }
    campaign.rows = rows.filter((_, i) => keep[i]);
  }
  rejected.sort((a, b) => a.row - b.row);
  if (!campaign.rows.length) return { outcome: { status: "rejected", errors: ["no valid rows"], rejected } };
  const decisions: ComparabilityDecision[] = [];
  if (ut && comparability) {
    const seen = new Set<string>();
    for (const r of campaign.rows) {
      const key = `${r.tag}|${r.position}`;
      if (seen.has(key)) continue;
      seen.add(key);
      decisions.push({
        kind: "comparability_decision",
        id: `DEC-UPL-${work_order}-${r.position}`,
        location_id: r.position,
        reading_ids: [...ctx.existingReadingIds(r.tag, r.position), `WB-${work_order}-${r.position}`],
        rationale,
        decided_by: decidedBy,
        decided_at: nowIso,
        provenance: { source_system: "engineer-entry", source_ref: `upload WO ${work_order}`, origin: "replay", basis: "engineer_entered", event_time: nowIso, ingested_at: nowIso },
      } as ComparabilityDecision);
    }
  }
  return {
    outcome: { status: "accepted", work_order, accepted_rows: campaign.rows.length, excluded_from_trends: excluded, rejected, decisions: decisions.length },
    stored: { campaign, decisions, uploaded_at: nowIso },
  };
}

// Full load-time schema check of one stored upload (C-030 polish): timestamps, campaign fields,
// every row and every decision. A malformed store refuses to load rather than feeding the ranking.
const isTs = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));
const isStr = (v: unknown) => typeof v === "string";
export function storedUploadProblem(u: unknown): string | null {
  if (!u || typeof u !== "object") return "not an object";
  const x = u as Partial<StoredUpload>;
  if (!isTs(x.uploaded_at)) return "uploaded_at is not a timestamp";
  const c = x.campaign as Partial<Campaign> | undefined;
  if (!c || typeof c !== "object") return "campaign missing";
  for (const k of ["work_order", "technique", "read_date", "performer"] as const) if (!isStr(c[k]) || !(c[k] as string).trim()) return `campaign.${k} missing`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.read_date as string) || new Date(`${c.read_date}T00:00:00Z`).toISOString().slice(0, 10) !== c.read_date) return "campaign.read_date is not a calendar date";
  if (c.origin !== "replay") return "campaign.origin must be replay";
  if (!isTs(c.ingested_at)) return "campaign.ingested_at is not a timestamp";
  if (!Array.isArray(c.rows) || !c.rows.length) return "campaign.rows missing";
  const ut = /^(UT|WUT)/i.test(c.technique as string);
  if (ut) {
    for (const k of ["procedure_id", "procedure_revision", "instrument_id", "calibration_ref"] as const) if (!isStr(c[k]) || !(c[k] as string).trim()) return `campaign.${k} missing`;
    if (!(typeof c.measurement_uncertainty_mm === "number" && Number.isFinite(c.measurement_uncertainty_mm) && c.measurement_uncertainty_mm >= 0)) return "campaign.measurement_uncertainty_mm invalid";
    if (!(QUALITIES as readonly string[]).includes(c.quality as string)) return "campaign.quality invalid";
  }
  for (const [i, r] of (c.rows as Partial<WorkbookRow>[]).entries()) {
    if (!r || !isStr(r.tag) || !isStr(r.position) || !(r.tag as string) || !(r.position as string)) return `row ${i}: tag/position missing`;
    if (ut ? !(typeof r.quant_reading === "number" && Number.isFinite(r.quant_reading) && r.quant_reading > 0) : !parseQualReading(r.qual_reading)) return `row ${i}: reading invalid`;
  }
  if (!Array.isArray(x.decisions)) return "decisions missing";
  for (const [i, d] of (x.decisions as Partial<ComparabilityDecision>[]).entries()) {
    if (!d || d.kind !== "comparability_decision" || !isStr(d.id) || !isStr(d.location_id) || !Array.isArray(d.reading_ids) || !d.reading_ids.length) return `decision ${i}: incomplete`;
    if (!isStr(d.rationale) || !(d.rationale as string).trim() || !isStr(d.decided_by) || !(d.decided_by as string).trim() || !isTs(d.decided_at)) return `decision ${i}: rationale/decided_by/decided_at invalid`;
  }
  return null;
}

// Durable, atomic store of accepted uploads (one JSON file, tmp + rename).
export class UploadStore {
  readonly file: string;
  private items: StoredUpload[];
  constructor(dir: string) {
    const root = resolve(dir);
    mkdirSync(root, { recursive: true });
    this.file = join(root, "uploads.json");
    if (existsSync(this.file)) {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as { version?: unknown; uploads?: unknown };
      if (raw?.version !== 1 || !Array.isArray(raw.uploads)) throw new Error(`corrupt upload store ${this.file}`);
      raw.uploads.forEach((u, i) => {
        const problem = storedUploadProblem(u);
        if (problem) throw new Error(`corrupt upload store ${this.file}: malformed upload entry ${i}: ${problem}`);
      });
      this.items = raw.uploads as StoredUpload[];
    } else this.items = [];
  }
  get all(): readonly StoredUpload[] {
    return this.items;
  }
  add(u: StoredUpload): void {
    if (this.items.some((x) => x.campaign.work_order === u.campaign.work_order)) throw new Error(`work order ${u.campaign.work_order} already imported`);
    const next = [...this.items, u];
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, uploads: next }, null, 2));
    renameSync(tmp, this.file);
    this.items = next;
  }
}

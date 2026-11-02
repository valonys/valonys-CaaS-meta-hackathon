// Inspection Workbook adapter: turns workbook-layout campaigns (one export per inspection campaign,
// rows = Work Order / Position / Class / Point Description / UoM / Tag / InspTechText / Quant or
// Qual Reading / Comment / Performer / Read Date) into the existing per-line CircuitFixture, plus
// decoded visual findings. Deterministic; nothing is inferred.
//
// The workbook does not carry procedure, instrument, calibration or uncertainty. Those come from
// campaign metadata entered by the engineer at import and are recorded as provenance. A UT row
// without them is rejected by the existing UT adapter, never filled in.

import type { ComparabilityDecision, EngineerLimit, RatePolicy } from "./evidence.ts";
import type { LocationRecord, RawUTRow } from "./ut-adapter.ts";
import type { CircuitFixture, SensorEvent } from "./workflow.ts";
import { parseQualReading, type DecodedCode } from "./codes.ts";

export interface WorkbookRow {
  tag: string; // Tag/Equipment (functional location)
  position: string; // CML id for UT rows; workbook position code for visual rows
  class: string;
  point_description: string;
  uom: string;
  quant_reading: number | null;
  qual_reading: string | null;
  comment: string;
}

export interface Campaign {
  work_order: string;
  technique: string; // InspTechText, e.g. UTM-01-100%, VIE-01-100%, VII-01-100%
  read_date: string;
  performer: string;
  rows: WorkbookRow[];
  origin?: "synthetic" | "replay"; // replay = uploaded recorded data
  ingested_at?: string; // when this campaign entered the system (uploads: the store's uploaded_at)
  // engineer attestation of reading quality for the campaign (UT). The workbook has no quality
  // column; without this the UT adapter treats readings as "missing" and rejects them.
  quality?: "good" | "suspect" | "bad" | "stale" | "missing";
  // engineer-entered campaign metadata (UT only)
  procedure_id?: string;
  procedure_revision?: string;
  instrument_id?: string;
  calibration_ref?: string;
  measurement_uncertainty_mm?: number;
}

export interface LineInfo {
  tag: string;
  line_number: string;
  unit: string;
  description: string;
  fluid: string;
  criticality: string;
  design_p_bar: number;
  oper_p_bar: number;
  design_t_c: number;
  oper_t_c: number;
  material: string;
  pid: string;
  // Engineer register: activation dates and the approved t_min with its provenance are explicit;
  // a CML without active_from is not registered (its readings are rejected), and one without a
  // t_min has no threshold (shown as a blind spot). Nothing is defaulted.
  cmls: {
    id: string;
    description: string;
    active_from?: string;
    active_to?: string | null;
    t_min?: { value_mm: number; source_document: string; source_revision: string; entered_by: string; entered_at: string; approval_status: string };
  }[];
}

export interface Portfolio {
  _label: string;
  plant: string;
  as_of: string;
  ingested_at: string;
  rate_policy: RatePolicy;
  lines: LineInfo[];
  campaigns: Campaign[];
  comparability_decisions: ComparabilityDecision[];
  sensor_events: (SensorEvent & { tag: string })[];
  images: { tag: string; position: string; image_ref: string }[];
}

export interface VisualFinding {
  record_id: string;
  tag: string;
  position: string;
  location_id: string | null; // set when the position is one of the line's CMLs
  class: string;
  point_description: string;
  technique: string;
  read_date: string;
  work_order: string;
  performer: string;
  code: DecodedCode | null;
  comment: string;
}

export interface LinePlan {
  line: LineInfo;
  fixture: CircuitFixture;
  findings: VisualFinding[];
}

export const isUT = (technique: string) => /^(UT|WUT)/i.test(technique);

export const lineAsset = (plant: string, line: LineInfo) => ({ plant, unit: line.unit, circuit: line.line_number, asset_tag: line.tag });

// The line's register as the UT adapter sees it (only CMLs with an explicit activation date).
export function lineRegister(plant: string, line: LineInfo): LocationRecord[] {
  const asset = lineAsset(plant, line);
  return line.cmls
    .filter((c) => typeof c.active_from === "string")
    .map((c) => ({
      ...asset,
      location_id: c.id,
      location_description: c.description,
      active_from: c.active_from as string,
      active_to: c.active_to ?? null,
      source_ref: `workbook-register#${line.tag}/${c.id}`,
    }));
}

// One workbook UT row as the UT adapter's raw input. Shared by the portfolio and by upload
// validation, so an import is accepted only if the engine itself would accept it.
export function toRawUTRow(plant: string, line: LineInfo, camp: Campaign, row: WorkbookRow, defaultIngestedAt: string): RawUTRow {
  return {
    record_id: `WB-${camp.work_order}-${row.position}`,
    ...lineAsset(plant, line),
    location_id: row.position,
    thickness_value: row.quant_reading,
    thickness_unit: row.uom,
    method: camp.technique,
    procedure_id: camp.procedure_id,
    procedure_revision: camp.procedure_revision,
    instrument_id: camp.instrument_id,
    calibration_ref: camp.calibration_ref,
    measurement_uncertainty_mm: camp.measurement_uncertainty_mm,
    event_time: `${camp.read_date}T00:00:00Z`,
    ingested_at: camp.ingested_at ?? defaultIngestedAt,
    quality: camp.quality, // engineer attestation; absent -> "missing" -> excluded from trends
    inspector: camp.performer,
    basis: "measured",
    source_system: "inspection-workbook",
    source_ref: `workbook WO ${camp.work_order} row ${row.position}`,
    origin: camp.origin ?? "synthetic",
  };
}

export function workbookToLines(p: Portfolio): LinePlan[] {
  return p.lines.map((line) => {
    const asset = lineAsset(p.plant, line);
    const cmlIds = new Set(line.cmls.map((c) => c.id));
    const register = lineRegister(p.plant, line);
    const ut_rows: RawUTRow[] = [];
    const findings: VisualFinding[] = [];
    for (const camp of p.campaigns) {
      for (const row of camp.rows) {
        if (row.tag !== line.tag) continue;
        const record_id = `WB-${camp.work_order}-${row.position}`;
        if (isUT(camp.technique) && row.quant_reading !== null) {
          ut_rows.push(toRawUTRow(p.plant, line, camp, row, p.ingested_at));
        } else if (row.qual_reading) {
          findings.push({
            record_id,
            tag: row.tag,
            position: row.position,
            location_id: cmlIds.has(row.position) ? row.position : null,
            class: row.class,
            point_description: row.point_description,
            technique: camp.technique,
            read_date: camp.read_date,
            work_order: camp.work_order,
            performer: camp.performer,
            code: parseQualReading(row.qual_reading),
            comment: row.comment,
          });
        }
      }
    }
    // Only CMLs with an explicit engineer t_min record get a limit; its fields pass through as entered.
    const limits: EngineerLimit[] = line.cmls
      .filter((c) => c.t_min !== undefined)
      .map((c) => ({
        kind: "engineer_limit",
        id: `LIM-${c.id}-TMIN`,
        asset: { ...asset, location_id: c.id },
        limit_type: "t_min",
        value: c.t_min!.value_mm,
        unit: "mm",
        source_document: c.t_min!.source_document,
        source_revision: c.t_min!.source_revision,
        entered_by: c.t_min!.entered_by,
        entered_at: c.t_min!.entered_at,
        approval_status: c.t_min!.approval_status,
        provenance: { source_system: "engineer-entry", source_ref: `workbook-limits#${line.tag}/${c.id}`, origin: "synthetic", basis: "engineer_entered", event_time: c.t_min!.entered_at, ingested_at: p.ingested_at },
      }) as EngineerLimit);
    const fixture: CircuitFixture = {
      _label: p._label,
      asset,
      register,
      ut_rows,
      comparability_decisions: p.comparability_decisions.filter((d) => cmlIds.has(d.location_id)),
      limits,
      rate_policy: p.rate_policy,
      process_samples: [],
      sensor_events: p.sensor_events.filter((e) => e.tag === line.tag),
    };
    return { line, fixture, findings };
  });
}

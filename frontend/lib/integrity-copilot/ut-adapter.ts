// Measured-UT and location-register adapters (framework/ADAPTERS.md).
// Rejected rows are retained with reason codes; nothing is repaired or invented.

import {
  isValidTimestamp,
  thicknessToMm,
  validateUTReading,
  type AssetNode,
  type DataOrigin,
  type Quality,
  type RejectReason,
  type UTReading,
} from "./evidence.ts";

export interface LocationRecord {
  plant: string;
  unit: string;
  circuit: string;
  asset_tag: string;
  location_id: string;
  location_description: string;
  active_from: string;
  active_to: string | null;
  source_ref: string;
}

export type RawUTRow = Record<string, unknown>;

export interface Rejected {
  record_id: string;
  source_ref: string;
  reasons: { reason: RejectReason; detail: string }[];
}

export interface IngestResult<T> {
  accepted: T[];
  rejected: Rejected[];
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// Exactly one active location must match the row's scope at its event time.
export function resolveLocation(
  register: LocationRecord[],
  scope: { plant: string; unit: string; circuit: string; asset_tag: string; location_id: string },
  eventTime: string
): { location: LocationRecord } | { reason: RejectReason; detail: string } {
  const t = Date.parse(eventTime);
  const matches = register.filter(
    (l) =>
      l.location_id === scope.location_id &&
      l.asset_tag === scope.asset_tag &&
      l.circuit === scope.circuit &&
      l.unit === scope.unit &&
      l.plant === scope.plant &&
      Date.parse(l.active_from) <= t &&
      (l.active_to === null || t < Date.parse(l.active_to))
  );
  if (matches.length === 1) return { location: matches[0] };
  if (matches.length > 1) return { reason: "asset_ambiguous", detail: `${matches.length} active register entries match ${scope.location_id}` };
  return { reason: "location_unknown", detail: `no active register entry for ${scope.asset_tag}/${scope.location_id} at ${eventTime}` };
}

export function ingestUTRows(rows: RawUTRow[], register: LocationRecord[]): IngestResult<UTReading> {
  const accepted: UTReading[] = [];
  const rejected: Rejected[] = [];
  const seenIds = new Set<string>();

  for (const row of rows) {
    const reasons: { reason: RejectReason; detail: string }[] = [];
    const id = str(row.record_id);
    const sourceRef = str(row.source_ref);
    const eventTime = str(row.event_time);
    const ingestedAt = str(row.ingested_at);

    if (!id || seenIds.has(id)) reasons.push({ reason: "provenance_incomplete", detail: id ? `duplicate record_id ${id}` : "record_id missing" });
    if (!sourceRef || !str(row.source_system) || !["live", "replay", "synthetic"].includes(str(row.origin))) {
      reasons.push({ reason: "provenance_incomplete", detail: "source_system, source_ref and origin (live|replay|synthetic) are required" });
    }
    if (str(row.basis) !== "measured") reasons.push({ reason: "basis_not_measured", detail: `basis "${str(row.basis)}" — UT thickness must be measured` });
    if (!isValidTimestamp(eventTime) || !isValidTimestamp(ingestedAt)) {
      reasons.push({ reason: "timestamp_invalid", detail: `event_time "${eventTime}" / ingested_at "${ingestedAt}"` });
    }

    let thicknessMm = NaN;
    const value = typeof row.thickness_value === "number" ? row.thickness_value : NaN;
    try {
      thicknessMm = thicknessToMm(value, str(row.thickness_unit));
      if (!(thicknessMm > 0)) reasons.push({ reason: "value_invalid", detail: `thickness ${value} must be positive` });
    } catch (e) {
      const unsupported = /Unsupported/.test((e as Error).message);
      reasons.push({ reason: unsupported ? "unit_unsupported" : "value_invalid", detail: (e as Error).message });
    }

    if (!str(row.method)) reasons.push({ reason: "method_missing", detail: "method is required" });
    if (!str(row.procedure_id) || !str(row.procedure_revision)) reasons.push({ reason: "procedure_missing", detail: "procedure_id and procedure_revision are required" });
    if (!str(row.instrument_id) || !str(row.calibration_ref)) reasons.push({ reason: "calibration_missing", detail: "instrument_id and calibration_ref are required" });
    const uncertainty = row.measurement_uncertainty_mm;
    if (typeof uncertainty !== "number" || !(uncertainty >= 0)) reasons.push({ reason: "uncertainty_invalid", detail: "measurement_uncertainty_mm must be a number >= 0" });

    const scope = {
      plant: str(row.plant),
      unit: str(row.unit),
      circuit: str(row.circuit),
      asset_tag: str(row.asset_tag),
      location_id: str(row.location_id),
    };
    if (isValidTimestamp(eventTime)) {
      const resolved = resolveLocation(register, scope, eventTime);
      if ("reason" in resolved) reasons.push(resolved);
    }

    if (reasons.length) {
      rejected.push({ record_id: id || "(missing)", source_ref: sourceRef, reasons });
      continue;
    }
    seenIds.add(id);

    // Measurement context travels with the reading so assessTrend can demand a comparability decision.
    const context: NonNullable<UTReading["context"]> = {};
    if (typeof row.surface_temp_c === "number" && Number.isFinite(row.surface_temp_c)) context.surface_temp_c = row.surface_temp_c;
    if (str(row.couplant)) context.couplant = str(row.couplant);
    if (str(row.coating)) context.coating = str(row.coating);

    const reading: UTReading = {
      kind: "ut_reading",
      id,
      asset: scope as AssetNode & { location_id: string },
      thickness_mm: thicknessMm,
      nominal_mm: typeof row.nominal_mm === "number" ? row.nominal_mm : undefined,
      method: str(row.method),
      procedure_id: str(row.procedure_id),
      procedure_revision: str(row.procedure_revision),
      instrument_id: str(row.instrument_id),
      calibration_ref: str(row.calibration_ref),
      uncertainty_mm: uncertainty as number,
      inspector: str(row.inspector) || undefined,
      context: Object.keys(context).length ? context : undefined,
      quality: (str(row.quality) || "missing") as Quality,
      provenance: {
        source_system: str(row.source_system),
        source_ref: sourceRef,
        origin: str(row.origin) as DataOrigin,
        basis: "measured",
        event_time: eventTime,
        ingested_at: ingestedAt,
      },
    };
    const residual = validateUTReading(reading);
    if (residual.length) {
      rejected.push({ record_id: id, source_ref: sourceRef, reasons: residual.map((detail) => ({ reason: "quality_not_usable" as RejectReason, detail })) });
      continue;
    }
    accepted.push(reading);
  }
  return { accepted, rejected };
}

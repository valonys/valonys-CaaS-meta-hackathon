// Inspection valuation codes (Inspection Workbook / SAP): "<2-digit condition><2-letter class>",
// e.g. 02CO = minor coating damage. Decoded with the reviewed CaaS code map; deterministic.
// A code not in the map is reported as "unmapped", never guessed.

import { INSPECTION_CODES } from "./inspection-codes.ts";

export type Severity = "unknown" | "low" | "medium" | "high" | "critical" | "unmapped";

export interface DecodedCode {
  code: string;
  severity: Severity;
  description: string;
  mechanism: string;
  severity_source: "code map" | "reviewed overlay" | "none";
}

// Reviewed severity overlay for legacy condition codes 05+ that the copied CaaS map leaves
// "unknown". Decision: the user, 2026-11-02 ("it should rank them"). Severities follow each
// code's own description; the copied map itself stays unchanged. 00xx codes (not inspected /
// not found / unknown) are deliberately NOT overlaid: they stay visible blind spots.
export const SEVERITY_OVERLAY: Record<string, { sev: Severity; basis: string }> = {
  "05RL": { sev: "medium", basis: "corrosion with 5 y < remaining life < 10 y" },
  "07FL": { sev: "high", basis: "corroded flange face, leak expected before next shutdown" },
  "08CO": { sev: "high", basis: "severe coating degradation with active corrosion" },
  "08WT": { sev: "high", basis: "severe corrosion, t_required < t < nominal" },
  "10TM": { sev: "critical", basis: "severe corrosion, t - (CR x interval) < t_min before next inspection" },
  "11TT": { sev: "critical", basis: "severe corrosion or erosion, t < t_min" },
  "12TL": { sev: "critical", basis: "through-thickness corrosion, leaks" },
};

const CODES: Record<string, { sev: Severity; desc: string; mech: string }> = INSPECTION_CODES;
const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0, unmapped: 0 };

export const severityRank = (s: Severity): number => SEVERITY_RANK[s];

export function decodeCode(code: string): DecodedCode {
  const c = code.trim().toUpperCase();
  const hit = CODES[c];
  if (!hit) return { code: c, severity: "unmapped", description: "unmapped code (not in the reviewed code map)", mechanism: "unmapped", severity_source: "none" };
  const overlay = hit.sev === "unknown" ? SEVERITY_OVERLAY[c] : undefined;
  return overlay
    ? { code: c, severity: overlay.sev, description: hit.desc, mechanism: hit.mech, severity_source: "reviewed overlay" }
    : { code: c, severity: hit.sev, description: hit.desc, mechanism: hit.mech, severity_source: hit.sev === "unknown" ? "none" : "code map" };
}

// Workbook "Qual Reading" cells look like "02CO - 1-Minor coating damage": the leading code governs.
export function parseQualReading(cell: string | null | undefined): DecodedCode | null {
  const m = /^\s*(\d{2}[A-Za-z]{2})\b/.exec(cell ?? "");
  return m ? decodeCode(m[1]) : null;
}

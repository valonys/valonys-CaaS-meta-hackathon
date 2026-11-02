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
}

const CODES: Record<string, { sev: Severity; desc: string; mech: string }> = INSPECTION_CODES;
const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0, unmapped: 0 };

export const severityRank = (s: Severity): number => SEVERITY_RANK[s];

export function decodeCode(code: string): DecodedCode {
  const c = code.trim().toUpperCase();
  const hit = CODES[c];
  return hit ? { code: c, severity: hit.sev, description: hit.desc, mechanism: hit.mech } : { code: c, severity: "unmapped", description: "unmapped code (not in the reviewed code map)", mechanism: "unmapped" };
}

// Workbook "Qual Reading" cells look like "02CO - 1-Minor coating damage": the leading code governs.
export function parseQualReading(cell: string | null | undefined): DecodedCode | null {
  const m = /^\s*(\d{2}[A-Za-z]{2})\b/.exec(cell ?? "");
  return m ? decodeCode(m[1]) : null;
}

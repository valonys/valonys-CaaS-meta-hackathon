// "Next spots": a deterministic, explainable ranking of where to inspect next, across lines.
// Inputs are the deterministic trend results plus decoded visual findings; no model is involved.
//
// Tiers (1 = most urgent):
//  1 act now          at or below t_min, next inspection overdue, or a critical visual finding
//  2 within 2 years   next inspection due within 2 years, remaining life < 5 years, or a high finding
//  3 open finding     a medium visual finding
//  4 blind spot       no usable trend (refused), sensor silent since its last reading, or an
//                     unranked finding: a mapped code whose severity the reviewed map leaves
//                     "unknown" (e.g. 00ND not inspected, 12TL through-thickness leak), or an
//                     unmapped code. These are never dropped; the code's own text is shown.
//  5 monitor          everything else with a trend
// Within a tier: shortest remaining life first (unknown last), then worst visual severity, then tag.
// Criticality is shown, not ranked on: its scale direction is site-specific.

import { MS_PER_YEAR, type TrendAssessment } from "./evidence.ts";
import { severityRank, type Severity } from "./codes.ts";
import type { LineInfo, VisualFinding } from "./workbook.ts";
import type { SensorEvent } from "./workflow.ts";

export interface LineResult {
  line: LineInfo;
  trends: TrendAssessment[];
  findings: VisualFinding[];
  sensor_events: SensorEvent[];
}

export interface NextSpot {
  tier: 1 | 2 | 3 | 4 | 5;
  tier_label: string;
  tag: string;
  line_number: string;
  location_id: string | null; // null = line-level finding
  location_description: string;
  criticality: string;
  remaining_life_years: number | null;
  governing_rate_mm_per_year: number | null;
  next_inspection_due: string | null;
  worst_finding: Severity | null;
  reasons: string[];
  evidence_ids: string[];
}

export const TIER_LABELS: Record<NextSpot["tier"], string> = {
  1: "Act now",
  2: "Within 2 years",
  3: "Open visual finding",
  4: "Blind spot / unranked finding",
  5: "Monitor",
};

const fmt = (n: number) => Number(n.toFixed(2)).toString();
const SEVERITY_TIER: Partial<Record<Severity, NextSpot["tier"]>> = { critical: 1, high: 2, medium: 3, unknown: 4, unmapped: 4 };

export function rankNextSpots(results: LineResult[], asOf: string): NextSpot[] {
  const now = Date.parse(asOf);
  const horizon = now + 2 * MS_PER_YEAR;
  const spots: NextSpot[] = [];

  for (const r of results) {
    // Only "low" (good condition) findings are left out; unknown and unmapped stay visible.
    const findingsAt = (loc: string | null) => r.findings.filter((f) => f.location_id === loc && f.code && f.code.severity !== "low");
    const describe = (f: VisualFinding) => {
      const unranked = f.code!.severity === "unknown" || f.code!.severity === "unmapped" ? " [unranked by the code map: engineer review]" : "";
      return `${f.code!.code} ${f.code!.description}${unranked} (${f.technique}, ${f.read_date}${f.comment ? `: ${f.comment}` : ""})`;
    };

    for (const cml of r.line.cmls) {
      const t = r.trends.find((x) => x.location_id === cml.id);
      const reasons: string[] = [];
      const evidence: string[] = [];
      let tier: NextSpot["tier"] = 5;
      let life: number | null = null;
      let rate: number | null = null;
      let due: string | null = null;
      let lastReading: number | null = null;

      if (!t || t.status === "refused") {
        tier = 4;
        reasons.push(t ? `no usable trend: ${t.reasons.map((x) => x.reason).join(", ")}` : "no UT readings");
      } else {
        evidence.push(...t.reading_ids);
        lastReading = Date.parse(t.latest.time);
        rate = t.governing.rate_mm_per_year;
        due = t.next_inspection_due ?? null;
        if (t.threshold.status === "at_or_below_t_min") {
          tier = 1;
          reasons.push(`latest ${fmt(t.threshold.latest_mm)} mm is at or below t_min ${fmt(t.threshold.t_min_mm)} mm`);
        } else if (t.threshold.status === "above_t_min") {
          life = t.threshold.remaining_life_years;
          if (due && Date.parse(due) <= now) {
            tier = 1;
            reasons.push(`next inspection was due ${due.slice(0, 10)}`);
          } else if ((due && Date.parse(due) <= horizon) || (life !== null && life < 5)) {
            tier = 2;
          }
          if (life !== null && rate !== null) reasons.push(`remaining life ${fmt(life)} y at governing ${fmt(rate)} mm/y (${t.governing.selected})`);
          else reasons.push("no wall loss beyond measurement uncertainty");
          if (due) reasons.push(`next inspection due ${due.slice(0, 10)}`);
        } else {
          tier = 4;
          reasons.push(`no usable threshold: ${t.threshold.status}`);
        }
      }

      // A sensor that went silent after its last reading: wall loss since then is unseen.
      const silent = r.sensor_events.filter((e) => e.location_id === cml.id && e.event_type === "connectivity_lost" && (lastReading === null || Date.parse(e.event_time) > lastReading));
      if (silent.length) {
        tier = Math.min(tier, 4) as NextSpot["tier"];
        reasons.push(`sensor ${silent[0].sensor_id} silent since ${silent[0].event_time.slice(0, 10)}; no reading after it`);
      }

      const fs = findingsAt(cml.id);
      let worst: Severity | null = null;
      for (const f of fs) {
        if (!worst || severityRank(f.code!.severity) > severityRank(worst)) worst = f.code!.severity;
        const ft = SEVERITY_TIER[f.code!.severity];
        if (ft) tier = Math.min(tier, ft) as NextSpot["tier"];
        reasons.push(`visual: ${describe(f)}`);
        evidence.push(f.record_id);
      }

      spots.push({
        tier,
        tier_label: TIER_LABELS[tier],
        tag: r.line.tag,
        line_number: r.line.line_number,
        location_id: cml.id,
        location_description: cml.description,
        criticality: r.line.criticality,
        remaining_life_years: life,
        governing_rate_mm_per_year: rate,
        next_inspection_due: due,
        worst_finding: worst,
        reasons,
        evidence_ids: evidence,
      });
    }

    // Findings recorded against a workbook position that is not a CML: a line-level spot.
    for (const f of findingsAt(null)) {
      const tier = SEVERITY_TIER[f.code!.severity] ?? 5;
      spots.push({
        tier,
        tier_label: TIER_LABELS[tier],
        tag: r.line.tag,
        line_number: r.line.line_number,
        location_id: null,
        location_description: `${f.point_description} (workbook position ${f.position})`,
        criticality: r.line.criticality,
        remaining_life_years: null,
        governing_rate_mm_per_year: null,
        next_inspection_due: null,
        worst_finding: f.code!.severity,
        reasons: [`visual: ${describe(f)}`, "line-level finding: not tied to a UT monitoring point"],
        evidence_ids: [f.record_id],
      });
    }
  }

  return spots.sort(
    (a, b) =>
      a.tier - b.tier ||
      (a.remaining_life_years ?? Infinity) - (b.remaining_life_years ?? Infinity) ||
      severityRank(b.worst_finding ?? "unknown") - severityRank(a.worst_finding ?? "unknown") ||
      `${a.tag}/${a.location_id}`.localeCompare(`${b.tag}/${b.location_id}`)
  );
}

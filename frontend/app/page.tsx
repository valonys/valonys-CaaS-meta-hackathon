"use client";

// Integrity Copilot workbench: one circuit, deterministic findings, optional Meta narrative,
// engineer decision. Every number shown comes from the server's deterministic workflow.

import { useCallback, useEffect, useState } from "react";
import type { RateResult, TrendAssessment } from "@/lib/integrity-copilot/evidence";
import type { PortfolioView, ReplayResult } from "@/lib/integrity-copilot/server";
import type { NextSpot } from "@/lib/integrity-copilot/nextspots";
import type { VisualEvidence } from "@/lib/integrity-copilot/visual";

const mm = (n: number) => `${Number(n.toFixed(4))} mm`;

function rate(r: RateResult): string {
  switch (r.status) {
    case "rate":
      return `${Number(r.rate_mm_per_year.toFixed(4))} mm/y`;
    case "within_uncertainty":
      return `within ±${Number(r.combined_uncertainty_mm.toFixed(3))} mm`;
    case "thickness_gain":
      return "wall gain (indeterminate)";
    default:
      return "n/a";
  }
}

function TrendRow({ t }: { t: TrendAssessment }) {
  if (t.status === "refused") {
    return (
      <tr className="border-t border-gray-800">
        <td className="py-2 pr-4 font-mono">{t.location_id}</td>
        <td colSpan={5} className="py-2 text-amber-300">
          refused: {t.reasons.map((r) => r.reason).join(", ")}
        </td>
      </tr>
    );
  }
  const th = t.threshold;
  const life = th.status === "above_t_min" && th.remaining_life_years !== null ? `${Number(th.remaining_life_years.toFixed(2))} y` : th.status === "at_or_below_t_min" ? "AT/BELOW t_min" : "—";
  return (
    <tr className="border-t border-gray-800">
      <td className="py-2 pr-4 font-mono">{t.location_id}</td>
      <td className="py-2 pr-4">{mm(t.latest.thickness_mm)}</td>
      <td className="py-2 pr-4">{rate(t.long_term)}</td>
      <td className="py-2 pr-4">{rate(t.short_term)}</td>
      <td className="py-2 pr-4">{t.governing.rate_mm_per_year === null ? "none" : `${Number(t.governing.rate_mm_per_year.toFixed(4))} mm/y (${t.governing.selected})`}</td>
      <td className={`py-2 ${th.status === "at_or_below_t_min" ? "text-red-400" : ""}`}>
        {life}
        {t.next_inspection_due ? ` · due ${t.next_inspection_due.slice(0, 10)}` : ""}
      </td>
    </tr>
  );
}

// SAM regions drawn over the image in percentages of the frame, so the overlay scales with the image.
function VisualPanel({ v }: { v: VisualEvidence }) {
  const label = v.origin === "recorded" ? `recorded ${v.recorded_at ?? ""}`.trim() : "live";
  return (
    <Section title={`Visual evidence (${v.model} · ${v.basis} · ${label})`}>
      <div className="grid gap-4 md:grid-cols-[minmax(0,28rem)_1fr]">
        <div className="relative w-full overflow-hidden rounded border border-gray-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={v.image_src} alt={`Inspection image ${v.image_ref}`} className="block h-auto w-full" />
          {v.frame &&
            v.regions.map((r, i) => (
              <div
                key={i}
                className="absolute border-2 border-cyan-300 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
                style={{
                  left: `${(r.x1 / v.frame!.w) * 100}%`,
                  top: `${(r.y1 / v.frame!.h) * 100}%`,
                  width: `${((r.x2 - r.x1 + 1) / v.frame!.w) * 100}%`,
                  height: `${((r.y2 - r.y1 + 1) / v.frame!.h) * 100}%`,
                }}
              >
                <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-cyan-300 px-1 font-mono text-[10px] text-black">{v.prompt}</span>
              </div>
            ))}
        </div>
        <div className="space-y-2 text-sm">
          <p>
            <span className="text-gray-400">Image</span> <span className="font-mono">{v.image_ref}</span>
          </p>
          <p>
            <span className="text-gray-400">Prompt</span> “{v.prompt}”
          </p>
          {v.status === "ok" ? (
            <p>
              <span className="text-gray-400">Regions</span> {v.regions.length}
            </p>
          ) : (
            <p className="text-amber-300">
              SAM {v.status}: {v.detail}
            </p>
          )}
          <p className="text-xs text-gray-500">{v.note}</p>
        </div>
      </div>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-800 bg-[#12151c] p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">{title}</h2>
      {children}
    </section>
  );
}

const TIER_STYLE: Record<number, string> = {
  1: "bg-red-900/60 text-red-200 border-red-700",
  2: "bg-amber-900/50 text-amber-200 border-amber-700",
  3: "bg-yellow-900/40 text-yellow-200 border-yellow-700",
  4: "bg-sky-950/60 text-sky-200 border-sky-800",
  5: "bg-gray-800/60 text-gray-300 border-gray-700",
};

// Deterministic ranking across lines: where to look next, and why. Click a row to open that line.
function NextSpotsPanel({ view, selected, onSelect }: { view: PortfolioView; selected: string | null; onSelect: (tag: string) => void }) {
  return (
    <Section title={`Next spots (deterministic ranking across ${view.lines.length} lines · as of ${view.as_of.slice(0, 10)})`}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-gray-400">
            <tr>
              <th className="pr-3 font-normal">Priority</th>
              <th className="pr-3 font-normal">Line</th>
              <th className="pr-3 font-normal">CML</th>
              <th className="pr-3 font-normal">Remaining life</th>
              <th className="pr-3 font-normal">Next due</th>
              <th className="font-normal">Why</th>
            </tr>
          </thead>
          <tbody>
            {view.spots.map((s: NextSpot, i) => (
              <tr key={i} onClick={() => onSelect(s.tag)} className={`cursor-pointer border-t border-gray-800 align-top hover:bg-gray-800/40 ${selected === s.tag ? "bg-gray-800/30" : ""}`}>
                <td className="py-2 pr-3">
                  <span className={`whitespace-nowrap rounded border px-2 py-0.5 text-xs ${TIER_STYLE[s.tier]}`}>{s.tier_label}</span>
                </td>
                <td className="py-2 pr-3 font-mono text-xs">{s.line_number}</td>
                <td className="py-2 pr-3 font-mono">{s.location_id ?? "line"}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{s.remaining_life_years === null ? "—" : `${Number(s.remaining_life_years.toFixed(2))} y`}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{s.next_inspection_due?.slice(0, 10) ?? "—"}</td>
                <td className="py-2 text-xs text-gray-300">
                  <ul className="list-disc pl-4">
                    {s.reasons.map((r, j) => (
                      <li key={j}>{r}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">{view.label}</p>
    </Section>
  );
}

// Import one inspection campaign in Inspection Workbook layout (CSV) with engineer campaign metadata.
function UploadPanel({ token, onDone }: { token: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({ work_order: "", technique: "UTM-01-100%", read_date: "", performer: "", procedure_id: "", procedure_revision: "", instrument_id: "", calibration_ref: "", measurement_uncertainty_mm: "", quality: "" });
  const [cmp, setCmp] = useState({ decided_by: "", rationale: "" });
  const [result, setResult] = useState<string[] | null>(null);
  const ut = /^(UT|WUT)/i.test(f.technique);
  const field = (k: keyof typeof f, label: string) => (
    <label className="text-xs text-gray-400">
      {label}
      <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="mt-0.5 w-full rounded border border-gray-700 bg-transparent px-2 py-1 text-sm text-gray-100" />
    </label>
  );
  async function submit() {
    setResult(null);
    if (!file) return setResult(["choose a CSV file first"]);
    const csv = await file.text();
    const res = await fetch("/api/integrity-copilot/upload", {
      method: "POST",
      headers: { "content-type": "application/json", "x-integrity-copilot-token": token },
      body: JSON.stringify({ csv, campaign: f, ...(ut && cmp.decided_by && cmp.rationale ? { comparability: cmp } : {}) }),
    });
    const body = await res.json();
    if (body.status === "accepted") {
      setResult([`Imported WO ${body.work_order}: ${body.accepted_rows} rows${body.decisions ? `, ${body.decisions} comparability decision(s)` : ""}${body.excluded_from_trends ? `; ${body.excluded_from_trends} row(s) attested non-good are kept out of trends` : ""}.`, ...body.rejected.map((r: { row: number; reason: string }) => `row ${r.row} rejected: ${r.reason}`)]);
      onDone();
    } else {
      setResult([...(body.errors ?? [body.error ?? `HTTP ${res.status}`]), ...(body.rejected ?? []).map((r: { row: number; reason: string }) => `row ${r.row} rejected: ${r.reason}`)]);
    }
  }
  return (
    <Section title="Import an inspection campaign (Inspection Workbook layout, CSV)">
      <p className="mb-3 text-xs text-gray-400">
        One CSV per campaign with the workbook columns. Templates:{" "}
        <a className="underline" href="/templates/workbook-ut-template.csv">UT</a> ·{" "}
        <a className="underline" href="/templates/workbook-visual-template.csv">visual</a> · demo file{" "}
        <a className="underline" href="/templates/example-ut-campaign-line-A.csv">example UT campaign, line A</a>. Excel users: Save As CSV. Requires the approver token.
      </p>
      <div className="grid gap-2 md:grid-cols-4">
        <label className="text-xs text-gray-400 md:col-span-4">
          CSV file
          <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-0.5 block text-sm text-gray-200" />
        </label>
        {field("work_order", "Work order")}
        {field("technique", "Technique (InspTechText)")}
        {field("read_date", "Read date (YYYY-MM-DD)")}
        {field("performer", "Performer")}
        {ut && field("procedure_id", "Procedure")}
        {ut && field("procedure_revision", "Revision")}
        {ut && field("instrument_id", "Instrument")}
        {ut && field("calibration_ref", "Calibration ref")}
        {ut && field("measurement_uncertainty_mm", "Uncertainty (mm)")}
        {ut && (
          <label className="text-xs text-gray-400">
            Reading quality (engineer attestation)
            <select value={f.quality} onChange={(e) => setF({ ...f, quality: e.target.value })} className="mt-0.5 w-full rounded border border-gray-700 bg-[#12151c] px-2 py-1 text-sm text-gray-100">
              <option value="">choose…</option>
              <option value="good">good</option>
              <option value="suspect">suspect</option>
              <option value="bad">bad</option>
              <option value="stale">stale</option>
              <option value="missing">missing</option>
            </select>
          </label>
        )}
      </div>
      {ut && (
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_3fr]">
          <label className="text-xs text-gray-400">
            Comparability: engineer
            <input value={cmp.decided_by} onChange={(e) => setCmp({ ...cmp, decided_by: e.target.value })} className="mt-0.5 w-full rounded border border-gray-700 bg-transparent px-2 py-1 text-sm text-gray-100" />
          </label>
          <label className="text-xs text-gray-400">
            Rationale (why these readings are comparable with the existing trend basis)
            <input value={cmp.rationale} onChange={(e) => setCmp({ ...cmp, rationale: e.target.value })} className="mt-0.5 w-full rounded border border-gray-700 bg-transparent px-2 py-1 text-sm text-gray-100" />
          </label>
        </div>
      )}
      <button onClick={() => void submit()} className="mt-3 rounded bg-sky-700 px-3 py-1 text-sm text-white hover:bg-sky-600">
        Import campaign
      </button>
      {result && (
        <ul className="mt-2 list-disc pl-4 text-xs text-gray-300">
          {result.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export default function Workbench() {
  const [data, setData] = useState<ReplayResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [engineer, setEngineer] = useState("");
  const [rationale, setRationale] = useState("");
  const [decisionMsg, setDecisionMsg] = useState<string | null>(null);
  const [view, setView] = useState<PortfolioView | null>(null);
  const [line, setLine] = useState<string | null>(null);

  const load = useCallback(async (tag?: string | null) => {
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (token) headers["x-integrity-copilot-token"] = token;
      const target = tag ?? line;
      if (target) headers["x-integrity-copilot-line"] = target;
      const res = await fetch("/api/integrity-copilot/replay", { headers });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body as ReplayResult);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [token, line]);

  // Re-read the ranking and the current line (after an import).
  async function refresh() {
    const res = await fetch("/api/integrity-copilot/portfolio");
    setView((await res.json()) as PortfolioView);
    await load(line);
  }

  const select = useCallback(
    (tag: string) => {
      setLine(tag);
      setDecisionMsg(null);
      void load(tag);
    },
    [load]
  );

  useEffect(() => {
    // First load: the ranking, then the top-ranked line. Later reloads are explicit.
    async function init() {
      try {
        const res = await fetch("/api/integrity-copilot/portfolio");
        const body = (await res.json()) as PortfolioView;
        setView(body);
        const top = body.spots[0]?.tag ?? null;
        setLine(top);
        await load(top);
      } catch (e) {
        setError((e as Error).message);
      }
    }
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(decision: "approved" | "rejected") {
    if (!data) return;
    setDecisionMsg(null);
    const res = await fetch("/api/integrity-copilot/decide", {
      method: "POST",
      headers: { "content-type": "application/json", "x-integrity-copilot-token": token },
      body: JSON.stringify({ proposal_id: data.proposal.id, engineer, rationale, decision }),
    });
    const body = await res.json();
    if (!res.ok) setDecisionMsg(body.error ?? (body.errors ?? []).join("; "));
    else {
      setDecisionMsg(`Recorded: ${decision} by ${engineer}`);
      await load();
    }
  }

  const p = data?.proposal;
  const meta = data?.meta_summary;

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Integrity Copilot</h1>
          {data && (
            <p className="text-sm text-gray-400">
              {data.asset.plant} / {data.asset.unit} / {data.asset.circuit} / {data.asset.asset_tag} · state{" "}
              <span className={data.framework_state === "exception_open" ? "text-amber-300" : "text-emerald-300"}>{data.framework_state}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Live mode requires the approver token for replay too, so it is reachable before any data loads. */}
          <input type="password" placeholder="Approver token" value={token} onChange={(e) => setToken(e.target.value)} className="w-40 rounded border border-gray-700 bg-transparent px-2 py-1 text-sm" />
          <button onClick={() => void load()} className="rounded border border-gray-700 px-3 py-1 text-sm hover:bg-gray-800">
            Re-run replay
          </button>
        </div>
      </header>

      {error && <div className="rounded border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</div>}

      {view && <NextSpotsPanel view={view} selected={line} onSelect={select} />}

      <UploadPanel token={token} onDone={() => void refresh()} />

      {data && <div className="rounded border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">{data.data_label}</div>}

      {data && (
        <>
          <Section title={`Line ${data.line.line_number}`}>
            <p className="text-sm">{data.line.description}</p>
            <p className="mt-1 font-mono text-xs text-gray-400">{data.line.tag}</p>
            {data.line.material !== "n/a" && (
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
                <div><dt className="text-gray-400">Fluid</dt><dd>{data.line.fluid}</dd></div>
                <div><dt className="text-gray-400">Criticality</dt><dd>{data.line.criticality}</dd></div>
                <div><dt className="text-gray-400">Design / oper. P</dt><dd>{data.line.design_p_bar} / {data.line.oper_p_bar} bar</dd></div>
                <div><dt className="text-gray-400">Design / oper. T</dt><dd>{data.line.design_t_c} / {data.line.oper_t_c} °C</dd></div>
                <div><dt className="text-gray-400">Material</dt><dd>{data.line.material}</dd></div>
                <div><dt className="text-gray-400">P&amp;ID</dt><dd>{data.line.pid}</dd></div>
              </dl>
            )}
          </Section>

          {data.findings.length > 0 && (
            <Section title={`Visual findings (${data.findings.length}, decoded from workbook codes)`}>
              <table className="w-full text-left text-sm">
                <thead className="text-gray-400">
                  <tr>
                    <th className="pr-3 font-normal">Position</th>
                    <th className="pr-3 font-normal">Point</th>
                    <th className="pr-3 font-normal">Code</th>
                    <th className="pr-3 font-normal">Severity</th>
                    <th className="pr-3 font-normal">Finding</th>
                    <th className="font-normal">Campaign</th>
                  </tr>
                </thead>
                <tbody>
                  {data.findings.map((f) => (
                    <tr key={f.record_id} className="border-t border-gray-800 align-top">
                      <td className="py-2 pr-3 font-mono">{f.location_id ?? f.position}</td>
                      <td className="py-2 pr-3">{f.point_description}</td>
                      <td className="py-2 pr-3 font-mono">{f.code?.code ?? "—"}</td>
                      <td className={`py-2 pr-3 ${f.code && ["medium", "high", "critical"].includes(f.code.severity) ? "text-amber-300" : f.code?.severity === "unmapped" ? "text-sky-300" : "text-gray-300"}`}>{f.code?.severity ?? "—"}</td>
                      <td className="py-2 pr-3">
                        {f.code?.description}
                        {f.comment && <div className="text-xs text-gray-400">{f.comment}</div>}
                      </td>
                      <td className="py-2 font-mono text-xs text-gray-400">
                        {f.technique} · {f.read_date} · WO {f.work_order}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}
          <Section title="UT trend per CML (deterministic)">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-gray-400">
                  <tr>
                    <th className="pr-4 font-normal">CML</th>
                    <th className="pr-4 font-normal">Latest</th>
                    <th className="pr-4 font-normal">Long-term</th>
                    <th className="pr-4 font-normal">Short-term</th>
                    <th className="pr-4 font-normal">Governing</th>
                    <th className="font-normal">Remaining life</th>
                  </tr>
                </thead>
                <tbody>
                  {data.trends.map((t) => (
                    <TrendRow key={t.location_id} t={t} />
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <div className="grid gap-4 md:grid-cols-2">
            <Section title={`Findings (${p!.findings.length})`}>
              <ul className="space-y-2 text-sm">
                {p!.findings.map((f, i) => (
                  <li key={i}>
                    {f.text}
                    <div className="mt-0.5 font-mono text-xs text-gray-500">{f.evidence.map((e) => e.record_id).join(" · ")}</div>
                  </li>
                ))}
              </ul>
            </Section>
            <Section title={`Data gaps (${data.data_gaps.length})`}>
              <ul className="list-disc space-y-1 pl-4 text-sm text-amber-200/90">
                {data.data_gaps.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </Section>
          </div>

          {data.visual && <VisualPanel v={data.visual} />}

          <Section title="Meta summary (model_inferred · narrative only, contains no numbers; every value above is deterministic)">
            {meta?.status === "ok" ? (
              <>
                <p className="whitespace-pre-wrap text-sm">{meta.text}</p>
                <p className="mt-2 font-mono text-xs text-gray-500">
                  {meta.model_id} · {meta.call_id}
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-400">
                Meta inference {meta?.status}: {meta && "reason" in meta ? `${meta.reason} — ${meta.detail}` : ""}. The deterministic result above is complete.
              </p>
            )}
          </Section>

          <Section title={`Proposal ${p!.id} · ${p!.status}`}>
            {p!.proposed_next_inspection && (
              <p className="mb-3 text-sm">
                Next: <strong>{p!.proposed_next_inspection.method}</strong> by <strong>{p!.proposed_next_inspection.due_by.slice(0, 10)}</strong> — {p!.proposed_next_inspection.rationale}
              </p>
            )}
            {p!.status === "draft" ? (
              <div className="grid gap-2 md:grid-cols-[1fr_2fr_auto_auto]">
                <input placeholder="Engineer (name)" value={engineer} onChange={(e) => setEngineer(e.target.value)} className="rounded border border-gray-700 bg-transparent px-2 py-1 text-sm" />
                <input placeholder="Rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} className="rounded border border-gray-700 bg-transparent px-2 py-1 text-sm" />
                <button onClick={() => void decide("approved")} className="rounded bg-emerald-700 px-3 py-1 text-sm hover:bg-emerald-600">
                  Approve
                </button>
                <button onClick={() => void decide("rejected")} className="rounded bg-gray-700 px-3 py-1 text-sm hover:bg-gray-600">
                  Reject
                </button>
              </div>
            ) : (
              <p className="text-sm">
                {p!.status} by {p!.approval?.engineer} at {p!.approval?.decided_at} — {p!.approval?.rationale}
              </p>
            )}
            {decisionMsg && <p className="mt-2 text-sm text-gray-300">{decisionMsg}</p>}
            {data.proposal_errors.length > 0 && <p className="mt-2 text-sm text-red-300">Proposal validation: {data.proposal_errors.join("; ")}</p>}
          </Section>
        </>
      )}
    </main>
  );
}

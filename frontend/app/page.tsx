"use client";

// Integrity Copilot workbench: one circuit, deterministic findings, optional Meta narrative,
// engineer decision. Every number shown comes from the server's deterministic workflow.

import { useCallback, useEffect, useState } from "react";
import type { RateResult, TrendAssessment } from "@/lib/integrity-copilot/evidence";
import type { ReplayResult } from "@/lib/integrity-copilot/server";
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

export default function Workbench() {
  const [data, setData] = useState<ReplayResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [engineer, setEngineer] = useState("");
  const [rationale, setRationale] = useState("");
  const [decisionMsg, setDecisionMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/integrity-copilot/replay", { headers: token ? { "x-integrity-copilot-token": token } : {} });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body as ReplayResult);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [token]);

  useEffect(() => {
    void load();
    // first load only; later reloads are explicit
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
        <button onClick={() => void load()} className="rounded border border-gray-700 px-3 py-1 text-sm hover:bg-gray-800">
          Re-run replay
        </button>
      </header>

      {data && <div className="rounded border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">{data.data_label}</div>}
      {error && <div className="rounded border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</div>}

      {data && (
        <>
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
              <div className="grid gap-2 md:grid-cols-[1fr_1fr_2fr_auto_auto]">
                <input type="password" placeholder="Approver token" value={token} onChange={(e) => setToken(e.target.value)} className="rounded border border-gray-700 bg-transparent px-2 py-1 text-sm" />
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

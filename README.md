# Integrity Copilot — Meta AI Developer Hackathon

**ValonyLabs.** A piping-integrity workbench for one circuit. It brings replayed process samples (PI), ultrasonic thickness (UT) readings, visual evidence and asset history together into one evidence-linked inspection proposal. A named engineer approves or rejects that proposal.

**Where to look next.** A deterministic *Next spots* ranking across lines combines UT corrosion rates and remaining life, decoded visual inspection findings (Inspection Workbook valuation codes), and blind spots such as silent sensors or refused trends. The scope is UT readings plus visual findings and line imagery. There is no 3D, photogrammetry or LiDAR, and images never produce a thickness value.

All learned inference uses Meta models. The narrative runs on **Meta Muse locally** (Muse Glimmer through the Ollama desktop runtime, on loopback, at no cost). Visual evidence comes from **Meta SAM 3.1**.

## What decides what

| Output | Basis | Produced by |
| --- | --- | --- |
| Corrosion rates, remaining life, next inspection date | **deterministic** | `lib/integrity-copilot/evidence.ts` (ST/LT rates, uncertainty policy, comparability checks) |
| Data gaps, framework state, proposal | **deterministic** | `lib/integrity-copilot/workflow.ts` |
| Narrative summary (EN + PT) | **model_inferred** (local Meta Muse Glimmer by default; Muse Spark only when explicitly configured) | `lib/integrity-copilot/gateway.ts` + `faithfulness.ts`. It never changes a deterministic output. |
| Next-spots ranking across lines | **deterministic** | `lib/integrity-copilot/nextspots.ts` (tiers: act now · within 2 years · open visual finding · blind spot · monitor, each with its reasons) |
| Visual findings | **inspection codes** | `lib/integrity-copilot/codes.ts` + `inspection-codes.ts` (reviewed valuation-code map; unknown codes are shown as "unmapped", never guessed) |
| Workbook import | **deterministic** | `lib/integrity-copilot/workbook.ts` (Inspection Workbook layout → per-line circuits; procedure, instrument, calibration and uncertainty come from engineer-entered campaign metadata) |
| Visual regions on the inspection image | **model_inferred** (recorded SAM 3.1 output by default, labelled as recorded; live SAM 3.1 only when opted in) | `lib/integrity-copilot/visual.ts` + `sam.ts` |
| Approval | **engineer** | `POST /api/integrity-copilot/decide`: named engineer, rationale required, single use, stored durably |

Rules the system enforces:
- **The narrative contains no numbers, by construction.** Muse receives the findings with every value masked as `[value]` and every identifier given a digit-free alias (`CML-03` becomes `CML#a`), so its request carries no digit. Any numeric content in the reply withholds the summary: digits in any script, `%`, fractions, EN/PT number words, hidden characters, or an alias used as a quantity. Real identifiers are restored only after the check passes. The exact values sit beside the narrative, from the deterministic engine.
- Wall thickness is never inferred from images. SAM regions show where the prompt matched; they are not evidence of corrosion type or depth.
- Replayed data is labelled as replayed, and a recorded model output is labelled as recorded.
- A missing PI value is reported as a data gap, never filled with zero.
- If a Meta model is unavailable, the result says `unavailable`. There is no fallback to any other provider. `npm run guard:providers` enforces this with an allowlist: the runtime may only reach `api.meta.ai` and the loopback local Muse endpoint.

## Run it

Requirements: Node 22.18 or newer (tests and scripts use Node's built-in TypeScript type stripping), and the [Ollama](https://ollama.com) desktop app with the `muse-glimmer` model available locally for live narratives. A default replay makes no model calls.

```bash
cd frontend
npm install
npm run demo                              # replay mode: deterministic results, recorded SAM, no model calls
INTEGRITY_COPILOT_LIVE=1 npm run demo     # live: narrative from local Muse Glimmer (no cost)
```

Open http://localhost:3000 in **Chrome or Edge** (the supported browsers; see the boundary notes below). The page opens on the *Next spots* ranking for a synthetic portfolio shaped like an Inspection Workbook export: three lines on a fictional SYN-FPSO, plus the original PC-01 circuit. Click a row to open that line's workbench (line details, decoded visual findings, UT trends, image evidence, narrative and proposal). Use the approver token printed in the terminal to approve or reject a proposal. The top spot is A-02 on the 18" gas line: governing rate 0.4 mm/y, remaining life 3.25 y, next inspection due 2026-10-15, with a coating finding on the same point. Decisions persist in `frontend/.data/`; delete it to reset the demo.

**Importing inspection campaigns.** Use *Import an inspection campaign* to upload one campaign as CSV in Inspection Workbook layout (`Tag/Equipment, Position, Class, Point Description, UoM, Quant Reading, Qual Reading, Comment / Text`); templates are linked on the page, and Excel users can Save As CSV. You enter the campaign metadata on the form: work order, technique, read date and performer, plus procedure, revision, instrument, calibration and uncertainty for UT. Rows must reference a registered line (UT rows: one of its CMLs); every rejected row is listed with its reason. A new reading with a different calibration breaks the existing comparability decision, so the trend is refused unless an engineer records a comparability decision (name and rationale) at import. Imports are stored in `frontend/.data/`, labelled as recorded data. A row is reported as accepted only if the trend engine's own validator accepts it (units, real calendar dates, register, identity), and rows attested non-good are reported as kept out of trends. The ranking is a snapshot as of the later of the portfolio date and the most recent import. Imports cannot be dated in the future, and nothing later than the snapshot (readings, comparability decisions, t_min records) affects it. After an import made today, the snapshot moves to today, so the demo's A-02 inspection becomes overdue (act now). The linked demo file adds a 2025-10-20 campaign for the 18" gas line: with the comparability decision, A-02 drops from 3.25 y to 0.74 y of remaining life. PDF reports are not imported yet.

In live mode the launcher runs one replay at start-up to warm the cache: with local Muse Glimmer the first narrative takes about a minute and a half on a laptop, and later replays come from the cache instantly. If paid API calls are opted in, that start-up replay can make one Muse Spark and one SAM 3.1 request, within the process-wide call and spend ceilings.

Optional paid Meta API calls are off by default and must be requested explicitly: `INTEGRITY_COPILOT_MUSE=api` (Muse Spark narrative) or `INTEGRITY_COPILOT_SAM=live` (live SAM 3.1). Either one needs `MODEL_API_KEY`, kept outside the repository.

## Checks

| Command | What it proves |
| --- | --- |
| `npm test` | Unit tests: evidence contracts, gateway (local Muse and API), SAM parsing, numeric guard, workflow, visual evidence, decision store, provider guard |
| `npx tsc --noEmit` | Type check |
| `npm run guard:providers` | The reachable import graph and every outbound host are on the Meta allowlist |
| `npm run build && npm run guard:providers:release` | Manifests, lockfile and build output are on the allowlist |
| `npm run test:routes` | API behaviour over HTTP (auth gate, validation, single-use approval) |
| `npm run acceptance` | Black-box acceptance, including decision persistence across a restart |

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `INTEGRITY_COPILOT_LIVE` | `0` | `1` turns on model calls (local Muse by default) |
| `INTEGRITY_COPILOT_APPROVER_TOKEN` | unset, so approval is disabled (503) | Shared approver secret (`npm run demo` generates one) |
| `INTEGRITY_COPILOT_DATA_DIR` | `.data` | Folder for the durable decision store and its audit trail |
| `INTEGRITY_COPILOT_MUSE` | local | `api` selects the paid Muse Spark narrative |
| `INTEGRITY_COPILOT_SAM` | recorded | `live` calls SAM 3.1 through the paid API |
| `INTEGRITY_COPILOT_MAX_CALLS` / `_MAX_USD` | 400 / 25 | Process-wide call and spend ceiling; it can only be lowered |

Boundary notes: the Meta-only boundary is a provider-policy control on reviewed source, not an OS sandbox. Its layers:
- syntax-tree policy on all reachable runtime source;
- in-process runtime controls installed at server start, through a small reviewed bootstrap trust root (`instrumentation.ts` + `lib/integrity-copilot/egress.ts`), before any route or page loads;
- browser runtime controls: the CSP with Trusted Types, WebRTC and fresh-window stubs, and cancellation of **cross-origin** top-level navigation. Browser enforcement is guaranteed in Chromium (Chrome and Edge), where the Navigation API exists.

Deployment note: the decision store writes to the local filesystem, and local Muse needs the Ollama desktop runtime on the same machine. The demo is meant to run as a single `next start` process on a workstation.

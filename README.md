# Integrity Copilot — Meta AI Developer Hackathon

**ValonyLabs.** A piping-integrity workbench for one circuit. It brings replayed process samples (PI), ultrasonic thickness (UT) readings, visual evidence and asset history together into one evidence-linked inspection proposal. A named engineer approves or rejects that proposal. The normal demo is a deterministic replay; the submission run below explicitly calls Muse Spark 1.3 and SAM 3.1 through Meta's API.

All learned inference uses Meta models. The narrative runs on **Meta Muse locally** (Muse Glimmer through the Ollama desktop runtime, on loopback, at no cost). Visual evidence comes from **Meta SAM 3.1**.

## What decides what

| Output | Basis | Produced by |
| --- | --- | --- |
| Corrosion rates, remaining life, next inspection date | **deterministic** | `lib/integrity-copilot/evidence.ts` (ST/LT rates, uncertainty policy, comparability checks) |
| Data gaps, framework state, proposal | **deterministic** | `lib/integrity-copilot/workflow.ts` |
| Narrative summary (EN + PT) | **model_inferred** (local Muse Glimmer or API Muse Spark 1.3, by explicit configuration) | `lib/integrity-copilot/gateway.ts` + `faithfulness.ts`. It never changes a deterministic output. |
| Visual regions on the inspection image | **model_inferred** (recorded SAM 3.1 output by default; live SAM 3.1 API when opted in) | `lib/integrity-copilot/visual.ts` + `sam.ts` |
| Approval | **engineer** | `POST /api/integrity-copilot/decide`: named engineer, rationale required, single use, stored durably |

Rules the system enforces:
- **The narrative contains no numbers, by construction.** Muse receives the findings with every value masked as `[value]` and every identifier given a digit-free alias (`CML-03` becomes `CML#a`), so its request carries no digit. Any numeric content in the reply withholds the summary: digits in any script, `%`, fractions, EN/PT number words, hidden characters, or an alias used as a quantity. Real identifiers are restored only after the check passes. The exact values sit beside the narrative, from the deterministic engine.
- Wall thickness is never inferred from images. SAM regions show where the prompt matched; they are not evidence of corrosion type or depth.
- Replayed data is labelled as replayed, and a recorded model output is labelled as recorded.
- A missing PI value is reported as a data gap, never filled with zero.
- If a Meta model is unavailable, the result says `unavailable`. There is no fallback to any other provider. `npm run guard:providers` enforces this with an allowlist: the runtime may only reach `api.meta.ai` and the loopback local Muse endpoint.

## Run it

Requirements: Node 20.19+ or Node 22.9+ for the TypeScript and `--env-file-if-exists` features used by the scripts. The optional local narrative path also needs the [Ollama](https://ollama.com) desktop app with `muse-glimmer` available.

```bash
cd frontend
npm install
npm run demo                              # replay mode: deterministic results, recorded SAM, no model calls
INTEGRITY_COPILOT_LIVE=1 npm run demo     # live: narrative from local Muse Glimmer (no cost)
```

Open http://localhost:3000 and use the approver token printed in the terminal to approve or reject the proposal. The workbench shows the replay for circuit PC-01 / CML-03: governing rate 0.1875 mm/y, remaining life 16 y, next inspection due 2032-01-01. Decisions persist in `frontend/.data/`; delete it to reset the demo.

In live mode the launcher runs one replay at start-up to warm the configured model caches. With local Muse Glimmer, the first narrative can take about a minute and a half on a laptop. In API mode this startup replay can make one Muse Spark request and one SAM 3.1 request; the process-wide budget and call limits apply.

Optional paid Meta API calls are off by default and must be requested explicitly: `INTEGRITY_COPILOT_MUSE=api` (Muse Spark narrative) or `INTEGRITY_COPILOT_SAM=live` (live SAM 3.1). Either one needs `MODEL_API_KEY`, kept outside the repository.

### Submission run: Muse Spark 1.3 + SAM 3.1

Store `MODEL_API_KEY` in `~/.config/caas-meta-hackathon/meta.env` (one `MODEL_API_KEY=...` line; do not put it in the repository). First run the one-request entitlement and response-schema check, capped at one call and $0.05:

```bash
npm run meta:smoke
```

Then start the demo with both current Meta models explicitly enabled:

```bash
INTEGRITY_COPILOT_LIVE=1 INTEGRITY_COPILOT_MUSE=api INTEGRITY_COPILOT_SAM=live npm run demo
```

The startup replay invokes the configured Muse narrative and SAM image analysis, then the UI reuses their validated cached results. The terminal and replay API response identify the requested and returned model IDs, live/recorded origin, status, and usage. If the API key, model entitlement, or response validation is unavailable, the app reports that state and does not substitute another provider. A default replay makes no model calls and uses recorded SAM output; do not describe that path as live inference.


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

Deployment note: the decision store writes to the local filesystem, and local Muse needs the Ollama desktop runtime on the same machine. The demo is meant to run as a single `next start` process on a workstation.

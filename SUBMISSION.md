# Integrity Copilot — submission preparation

**Status:** draft; not submitted.

## Project

**ValonyLabs Integrity Copilot** is a piping integrity workbench for one circuit. It turns replayed PI samples, ultrasonic thickness readings, a synthetic inspection image, and asset history into traceable engineering calculations and a draft inspection proposal. A named engineer must approve or reject it.

**Track:** Startup. **Theme:** Push the Frontier.

## Meta model use

The recommended submission demonstration explicitly invokes **Muse Spark 1.3** for the English and Portuguese narrative and **SAM 3.1** for regions on the synthetic inspection image. The calls go through `frontend/lib/integrity-copilot/gateway.ts`, which pins the Meta API host, enforces the model allowlist, records validated usage, applies call and spend ceilings, and fails closed without a provider fallback.

`npm run meta:smoke` performs one Muse Spark API request with a one-call, $0.05 ceiling. A successful result verifies the configured key, account entitlement, returned model ID, usage schema, and response parsing. No live request has been executed from this workspace because no Meta API key was available.

The default replay intentionally performs no live model calls: it uses deterministic calculations, an unavailable narrative status, and a recorded SAM output clearly labelled as recorded. The optional local path uses Meta Muse Glimmer via Ollama. Do not present either default replay or the local Glimmer path as a Muse Spark + live SAM run.

## Reproduce the demonstration

Requirements: Node 20.19+ or Node 22.9+, npm, and a Meta Model API key with Muse Spark 1.3 and SAM 3.1 access.

```bash
cd frontend
npm ci
```

Place the key in `~/.config/caas-meta-hackathon/meta.env` outside the repository:

```text
MODEL_API_KEY=<your Meta Model API key>
```

Verify API access, then launch the live-model demo:

```bash
npm run meta:smoke
INTEGRITY_COPILOT_LIVE=1 INTEGRITY_COPILOT_MUSE=api INTEGRITY_COPILOT_SAM=live npm run demo
```

Open `http://localhost:3000`. Show the circuit PC-01 / CML-03, the deterministic corrosion rate and remaining-life calculation, the data-gap list, the SAM regions over the synthetic pipe image, and the returned Muse narrative with its model ID and live status. The demo prints an approver token; use it only for the local engineer decision flow. The sample is synthetic/replayed and is not connected to live plant PI, UT, CMMS, or historian systems.

## Evidence and validation

Meta API provenance is available in the replay result's model ID, origin, call ID, status, and usage fields. `frontend/scripts/meta-smoke.ts` prints a usage result and never prints the API key or prompt. The repository includes fixtures from a live SAM 3.1 synthetic-image call and Meta Muse narrative outputs; fixtures are reference evidence, not a substitute for rerunning the live smoke on the submission machine.

Checks run on the repository snapshot with Node 24.22.1 on 2026-10-30:

- `npm test`: 71 passed, 1 skipped, 0 failed.
- `npx tsc --noEmit`: passed.
- `npm run guard:providers`: passed; only the Meta API and loopback Muse hosts are reachable.
- `npm run build`: passed.
- `npm run test:routes`: passed (auth, validation, approve/repeat behavior).
- `npm run acceptance`: passed (replay, decision persistence across restart, and legacy routes absent).
- `npm run meta:smoke`: exited before making a request because `MODEL_API_KEY` was absent.

## Links and submission status

- Repository: https://github.com/valonys/valonys-CaaS-meta-hackathon (currently private; organizer access or public visibility is needed for an external reviewer).
- Demonstration: local reproducible run above; no hosted demo URL or recorded video is present in the repository snapshot.
- Official event and deadline: https://dev.meta.ai/events/global-hackathon (Nov 4, 2026, 9:00 PM ET / Nov 5, 2026, 03:00 Luanda).
- The participant sign-in flow reached an `Invalid CSRF token` error in the browser session. The prior project context says the applicant was accepted, but the live account status and submission form have not been re-verified in this session.

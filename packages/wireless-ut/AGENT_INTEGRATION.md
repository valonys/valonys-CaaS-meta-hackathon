# Wireless UT agent integration boundary

## Role in Integrity Copilot

The Wireless UT package is an evidence source and deterministic engineering module first. A future `WirelessUTAnalyst` agent may coordinate tools and summarize cited results, but it must not infer measurements, conceal missing data or make autonomous fitness-for-service or continued-operation decisions.

The agent's useful responsibilities are:

- validate asset, circuit, CML and sensor identity before joining records;
- request deterministic unit normalization, comparability checks and trend calculations;
- retrieve baseline maps, point readings, process events, quality flags and inspection history by evidence ID;
- explain data gaps, uncertainty and unmonitored areas;
- propose a verification or inspection action with cited evidence;
- route the proposal to a named engineer for edit, approval or rejection; and
- preserve the final decision, reviewer and evidence chain.

## Orchestration pattern adopted

The current `AgentStack-HealthcareAgent` example (reviewed at commit `d5ee60d7fb923a1d2b930dbe4411a14e6ceed139`) demonstrates useful patterns: discoverable named agents, explicit handoff tools, requirement-constrained tool use, streamed final-answer events and bounded trajectory metadata. The local A2A Blueprint adds agent cards, typed task IDs and statuses, health checks, discipline ownership and coordinator-mediated handoffs.

Applied to this project:

1. The Integrity Copilot orchestrator discovers the UT capability by a versioned agent card rather than a hard-coded prompt convention.
2. A typed task records `task_id`, asset/circuit scope, required evidence IDs, requester, status and approval state.
3. A handoff is explicit: the orchestrator sends only the evidence references and decision question required by the UT analyst.
4. The UT analyst invokes deterministic tools for validation and calculations, then returns findings, unresolved gaps and proposed actions with evidence references.
5. The trajectory records agents and tools actually invoked, inputs by ID, validation outcomes and errors. It does not expose secrets, full sensitive prompts or claim every connected agent was used.
6. The final proposal remains unapproved until a named engineer acts. Agent completion and engineering approval are separate states.

## Proposed capability card

```json
{
  "name": "WirelessUTAnalyst",
  "version": "0.1.0",
  "description": "Validates and interprets traceable Wireless UT monitoring evidence for engineer review",
  "capabilities": {
    "streaming": true,
    "engineerApprovalRequired": true
  },
  "skills": [
    {
      "id": "wireless_ut_evidence_review",
      "name": "Wireless UT evidence review",
      "tags": ["piping", "ut", "corrosion", "monitoring", "evidence"],
      "outputs": ["cited_findings", "data_gaps", "inspection_proposal"]
    }
  ]
}
```

The transport URL, protocol version and deployment location remain configuration, not hard-coded capability data.

## Runtime boundaries

- All learned inference in the hackathon artifact goes through the single audited Meta gateway. There is no non-Meta inference or fallback path.
- Deterministic code owns unit conversion, timestamp handling, asset joins, quality rules, trend calculation and budget enforcement.
- UT readings must have measured provenance and an inspection method. Model-inferred or image-derived thickness is rejected.
- The agent may describe a SAM mask or visual observation only as visual evidence. Segmentation does not prove corrosion type, depth or structural adequacy.
- Missing Meta credentials or model availability produces an explicit unavailable state; deterministic validation and stored evidence remain accessible.
- Contributor model variants are excluded because inspection evidence may be sensitive and must not be submitted for model training without explicit written authorization.

## Minimum tools

| Tool | Deterministic contract | Failure behavior |
| --- | --- | --- |
| `resolve_asset_scope` | Resolve Plant > Unit > Circuit > Asset > InspectionLocation and reject ambiguous joins | Return explicit ambiguity or not-found state |
| `load_ut_history` | Return measured readings, method, units, quality, event/ingestion times and evidence IDs | Never synthesize missing readings |
| `check_comparability` | Require matching CML and method and acceptable quality before a trend | Return reasons for refusal |
| `calculate_thickness_trend` | Calculate approved rate and remaining life only with engineer-entered `t_min` and source | Return assumptions and no-result state when invalid |
| `load_visual_evidence` | Return image/frame IDs, timestamps, origin and any Meta model provenance | Never map visual appearance to thickness |
| `draft_inspection_proposal` | Produce evidence-linked findings, gaps and proposed verification actions | State remains `draft` until engineer approval |

## Practices intentionally not adopted

The blueprint's hypothetical package pins, fixed localhost ports and provider assumptions are not production contracts. Broad exception-to-string handling is rejected in favor of typed unavailable, validation and transport failures. The orchestration record lists only agents actually invoked. Agent health checks establish availability, not engineering validity. Parallel execution is allowed only for independent retrieval or analysis steps; calculations that depend on validated upstream records remain ordered.

## Production-readiness gates

- Agent card schema and protocol version validated against the selected current A2A implementation.
- Contract tests for task lifecycle, unavailable agents, malformed handoffs, duplicate events and timeout behavior.
- Negative tests proving no non-Meta fallback and no model-derived UT measurement.
- Evaluation fixtures for mismatched assets, units, methods, stale/missing telemetry and insufficient history.
- Secret-safe trajectory logs with evidence IDs, actual model ID, latency, usage and outcome.
- Human approval enforced server-side, not only in the interface.

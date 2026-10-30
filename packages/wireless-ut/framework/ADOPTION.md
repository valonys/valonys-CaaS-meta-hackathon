# Adoption map

## Shared rule

This framework is the UT source of truth. The presentation evidence is background research only. Contract changes are proposed, reviewed independently and merged only after tests pass.

## Build scope

- implement the Wireless UT runtime types and adapters under the self-contained Integrity Copilot module;
- implement Meta model calls and explicit unavailable behavior;
- implement deterministic comparability, trend and threshold states;
- implement the replay workflow and workbench using synthetic data clearly labelled `synthetic` until real site data is supplied; and
- preserve server-side engineer approval gates.

## Verification scope

- maintain contract and provenance tests against this framework;
- implement and run the provider-boundary guard;
- independently hand-check trend, uncertainty and threshold fixtures;
- test asset mismatches, method/procedure/calibration changes, missing/stale data and citation scope;
- verify that no presentation frame is used as demo-asset inspection evidence; and
- record review verdicts and exact test evidence.

## Initial shared acceptance scenario

Use one synthetic piping circuit and one CML with clearly synthetic, hand-calculable readings. The scenario must exercise valid trend calculation, a refused non-comparable trend, a missing-data state, an explicit Meta-unavailable state, an evidence-linked draft proposal and named engineer approval. Background presentation media may appear only in an explanatory “project basis” section separate from the circuit evidence timeline.

## Definition of framework coverage

The UT part is covered when the demo can ingest the agreed records, preserve provenance, calculate only valid deterministic results, explain gaps, produce a cited draft action, require human approval and pass the negative/provider-boundary tests. A polished dashboard without these gates does not satisfy framework coverage.

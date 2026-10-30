# Wireless UT framework for Integrity Copilot

## Framework objective

This is the canonical build contract for the UT portion of the hackathon. It converts the Wireless UT base case into a reusable workflow that can accept site-verified asset data, baseline mapping, fixed-sensor readings, process context and inspection history without assuming that any presentation material describes the demo circuit.

The framework supports one smallest end-to-end slice first: one circuit, at least two valid comparable UT readings at one CML, optional process samples, an evidence-linked trend, an exception or data-gap assessment, and an engineer-reviewed inspection proposal. The same contracts scale to the proposed three-to-five-circuit pilot.

## Inputs and outputs

### Runtime inputs

- asset hierarchy and circuit register;
- inspection-location/CML register with coordinates and coverage statement;
- baseline and subsequent measured UT readings;
- fixed-sensor health and configuration events;
- optional process samples with common timestamps;
- inspection, repair and leak history; and
- engineer-entered limits, procedures and approval decisions.

Runtime inputs must use the contracts in [`ADAPTERS.md`](ADAPTERS.md). The repository does not currently contain real circuit measurements; the base-case example therefore declares runtime data as `not_provided`.

### Framework outputs

- accepted and rejected records with validation reasons;
- deterministic long-term and short-term trend candidates with uncertainty and comparability evidence;
- an explicit governing-rate selection under a named approved policy;
- data-health, coverage and evidence-gap states;
- alerts that act only as review triggers;
- a draft inspection/verification proposal linked to evidence IDs; and
- a named engineer decision with timestamp and rationale.

## Component boundaries

| Component | Owns | Must not do |
| --- | --- | --- |
| Asset resolver | Plant > Unit > Circuit > Asset > InspectionLocation identity and joins | Guess an ambiguous tag or CML |
| UT adapter | Units, method, procedure, calibration, uncertainty, temperature/context and provenance | Accept model- or image-derived thickness |
| Sensor-health adapter | Device, battery/connectivity, configuration and missing-data states | Treat communication health as measurement validity |
| Trend engine | Comparable-reading selection and deterministic calculations | Select a governing engineering policy silently |
| Evidence store | Immutable IDs, event/ingestion times, origin and source references | Rewrite provenance after ingestion |
| Meta gateway | Document/visual interpretation and evidence-linked summarization | Create measurements, use contributor models or fall back to another provider |
| UT analyst agent | Coordinate tools, explain evidence and draft a proposal | Approve FFS, continued operation or inspection deferral |
| Engineer approval service | Record named approval/rejection, time and rationale | Delegate approval to the model or UI state alone |

## Data classes

The framework uses five provenance classes:

1. `measured`: instrument observations such as UT thickness.
2. `derived`: deterministic calculations from accepted records.
3. `model_inferred`: Meta model interpretation with gateway call provenance; never a measurement.
4. `engineer_entered`: limits, comparability decisions, policies and approvals.
5. `background_research`: the source video, audio, frames, proposal and poster used to design this framework.

`background_research` is deliberately absent from the runtime measurement adapters. It may support explanatory UI content or project documentation, but it cannot be cited as evidence that the demo circuit has a condition or defect.

## End-to-end framework flow

1. Load the project definition and verify that planning assumptions remain labelled as assumptions.
2. Resolve asset and CML identity; quarantine ambiguous or mismatched records.
3. Ingest measured UT and sensor-health records through separate adapters.
4. Validate units, method, procedure/calibration context, uncertainty, timestamps and quality.
5. Select comparable readings under an explicit engineer-approved comparability rule.
6. Calculate long-term and, when enough valid history exists, short-term trend candidates.
7. Apply an explicit governing-rate policy and evaluate against an engineer-entered `t_min`.
8. Join optional process context by timestamps without asserting causality.
9. Generate evidence-linked findings, data gaps and a proposed verification action.
10. Require named engineer approval or rejection and preserve the complete decision trajectory.

## Minimum acceptance gates

- A missing or invalid Meta service returns `unavailable`; it never changes deterministic records or falls back to a non-Meta provider.
- No visual or model result can populate thickness, corrosion rate, `t_min` or remaining life.
- A trend is refused when CML, method, procedure/calibration context or uncertainty is not comparable.
- Thickness at or below `t_min` produces an exceeded-threshold state, not negative future remaining life.
- Every finding cites known evidence IDs within the same asset scope.
- Presentation frames never appear in a demo-circuit evidence list.
- Approval requires a named engineer, timestamp and rationale.

## Framework files

- [`WORKFLOW.md`](WORKFLOW.md): lifecycle states and engineering gates.
- [`ADAPTERS.md`](ADAPTERS.md): runtime CSV/JSON interface contracts.
- [`contracts/wireless-ut-project.schema.json`](contracts/wireless-ut-project.schema.json): machine-readable project-definition schema.
- [`examples/offshore-base-case.json`](examples/offshore-base-case.json): assumption-only base-case instance with no fabricated measurements.
- [`ADOPTION.md`](ADOPTION.md): build and verification scope and the initial acceptance scenario.

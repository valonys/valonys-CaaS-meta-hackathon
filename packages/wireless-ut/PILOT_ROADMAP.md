# Wireless UT pilot implementation roadmap

## Planning basis

The pilot is planned over approximately nine months for three to five offshore piping circuits and 24 to 40 monitoring locations. The scope includes insulated and uninsulated piping selected by consequence, credible damage mechanism, information gap and deployability. All quantities and durations are planning assumptions that require site verification and engineering approval.

The pilot retains existing statutory and risk-based inspection obligations. It combines baseline spatial coverage with selected fixed-point monitoring; it does not claim that isolated sensors map the complete circuit or detect leaks.

## Gated roadmap

| Phase | Indicative timing | Core work | Required evidence and exit gate |
| --- | --- | --- | --- |
| 1 Define and rank | Month 0 to 1.5 | Confirm leak history, inspection history, damage mechanisms, decisions to support, candidate circuits, stakeholders, process-data needs and applicable standards. | Approved pilot charter, ranked circuits, named integrity authority and explicit non-goals. Gate: authorize field survey only. |
| 2 Survey and establish baseline | Month 1.5 to 3 | Access and radio survey; baseline qualified UT and, where justified, spatial mapping; insulation/CUI assessment; sensor-location and uncertainty rationale. | Coverage map with unmeasured areas, raw-data provenance, reference readings, installation basis and radio/OT concept. Gate: approve final locations and technology. |
| 3 Install and commission | Month 3 to 4 | Execute approved workpack; prepare surfaces; install sensors and gateway; restore coating/insulation/weather barrier; configure identities, time synchronization, quality flags and alert test. | Commissioning dossier, paired reference-UT agreement, repeatability evidence, data-loss/recovery test and controlled alert-response exercise. Gate: authorize monitored operation. |
| 4 Operate and review | Month 4 to 9 | Collect at least six months of data where feasible; monitor data health; review exceptions; correlate process events; perform scheduled independent checks; preserve an auditable decision log. | Valid-data report, exception and verification records, sensor/configuration history, access effort and evidence-linked engineering reviews. Gate: continue, adjust or stop. |
| 5 Evaluate and decide | Final four weeks, overlapping Month 9 where practical | Assess measurement agreement, repeatability, data availability, decision value, response performance, actual effort and full lifecycle cost. | Close-out report with stop, extend or scale recommendation approved by the competent integrity authority and sponsor. |

If expected wall change over six months is below measurement uncertainty, extend the observation window or conclude that the pilot cannot evaluate corrosion-rate detection. A stable trace is not proof of no corrosion outside the measurement footprint.

## Minimum architecture

1. Asset, circuit, CML and sensor identities are assigned before data collection.
2. Baseline measurements and coverage records are stored with units, method, instrument, calibration, timestamp, uncertainty and reviewer.
3. Fixed sensors capture thickness-related signals with temperature and quality context.
4. An approved wireless route and gateway buffer and transfer records without becoming a safety-critical control.
5. A controlled data service preserves immutable event and ingestion times, configuration history and missing/invalid-data states.
6. Deterministic code validates units and comparability, calculates permitted trends and links every output to evidence.
7. Meta models may interpret documents or summarize cited evidence, but cannot create measurements or approve engineering decisions.
8. Alerts enter a named review workflow; independent verification precedes integrity disposition.

## Location selection rules

Prioritize circuits where additional information can change an inspection, maintenance or process decision. Use consequence, repeated leakage, CUI susceptibility, internal corrosion/erosion mechanisms, known low readings, process transitions, geometric susceptibilities, access constraints and inspection-history gaps. Facility age alone is not a selection criterion.

For insulated piping, the workpack must control local insulation removal, baseline inspection, sensor installation, coating restoration and weather sealing. For uninsulated piping, the baseline must include sufficient adjacent coverage to assess whether the point is representative. In both cases, preserve access for independent verification.

## Acceptance measures

Targets are approved before commissioning and derived from site needs and measurement uncertainty, not copied from presentation claims.

| Measure | Definition | Evidence |
| --- | --- | --- |
| Valid-data availability | Accepted readings divided by scheduled readings per location and period, with outages and rejected data separate | Automated completeness and quality report |
| Measurement agreement | Difference between installed sensor and qualified reference UT under controlled conditions | Paired commissioning and periodic readings |
| Repeatability | Variation under stable conditions with temperature, coupling and configuration context | Approved repeatability protocol and analysis |
| Traceability | Accepted records linked to asset, location, instrument, configuration, calibration and reviewer | Traceability audit |
| Detection and decision value | Verified change or stable period that materially informs a defined decision | Decision log with independent-verification outcome |
| Response performance | Time from exception to acknowledgement, technical review and disposition | Timestamped exercise and live-event records |
| Inspection effort | Actual access hours, repeat visits and targeted-inspection effort against a comparable baseline | Work-order and cost records; no assumed avoided-loss value |

## Stop conditions

Pause or stop the pilot if measurement uncertainty is not fit for the decision, sensor placement is not demonstrably representative, installation creates an integrity concern, hazardous-area or OT controls are unmet, data provenance is broken, independent verification materially disagrees without resolution, or responsible engineering review cannot be maintained.

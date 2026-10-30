# Wireless UT framework lifecycle

## State model

| State | Entry requirement | Required output | Exit authority |
| --- | --- | --- | --- |
| `candidate` | Circuit nominated with business reason | Candidate record and unresolved data list | Integrity owner |
| `defined` | Asset identity, damage mechanism, decision need and non-goals confirmed | Approved basis and location-selection criteria | Multidisciplinary design review |
| `baselined` | Qualified baseline UT/spatial coverage complete | Coverage map, CML register, uncertainty and unmeasured areas | UT procedure owner and integrity authority |
| `commissioned` | Sensors installed and paired checks accepted | Configuration, calibration, time-sync, data-loss and controlled-alert evidence | Inspection lead, OT and integrity authority |
| `monitoring` | Data pipeline and review ownership active | Valid, missing, stale and rejected records remain explicit | Named operating reviewers |
| `exception_open` | Threshold, rate change, quality anomaly or data gap detected | Evidence-linked exception and required verification | Integrity reviewer |
| `verified` | Approved independent check completed | Verification result and adjacent-coverage decision | Qualified inspection/engineering reviewer |
| `decided` | Evidence and verification reviewed | Approved, rejected or revised action with rationale | Named competent engineer |
| `closed` | Actions complete or pilot stopped | Immutable close-out and lessons | Sponsor and integrity authority |

## Guard rules

- States advance only when required evidence exists; a model-generated narrative cannot satisfy an engineering gate.
- Missing or bad data may move a record to `exception_open`; it must not be silently filtered out of the trajectory.
- An alert does not move the workflow to `decided`.
- `monitoring` can continue during a non-safety-critical connectivity outage only under the approved missing-data procedure; no safety function depends on this framework.
- A sensor configuration, location or calibration change starts a new comparability segment.
- Any later reduction of inspection scope requires a separate RBI/MOC decision outside this workflow.

## Task and handoff status

Agent tasks use `submitted`, `working`, `input_required`, `completed`, `failed` and `cancelled`. Engineering lifecycle state is stored separately. An agent task can be `completed` while the inspection proposal remains `draft`; the system must never equate task completion with engineering approval.

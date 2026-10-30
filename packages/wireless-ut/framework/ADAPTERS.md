# Wireless UT runtime adapter contracts

## General record requirements

Every runtime record carries `record_id`, asset scope, `event_time`, `ingested_at`, `origin`, `basis`, `source_system`, `source_ref` and `quality`. Times use ISO 8601 with an offset. IDs are stable and unique. Missing values are explicit and never represented by zero.

## Asset and inspection-location register

Required fields: `plant`, `unit`, `circuit`, `asset_tag`, `location_id`, `location_description`, `active_from`, `active_to`, `source_ref`.

Recommended fields: pipe size/schedule, material, service, insulation state, coordinates, orientation, damage mechanisms, consequence class and coverage statement. These fields are engineering metadata, not model guesses.

## Measured UT reading

Required fields:

| Field | Rule |
| --- | --- |
| `record_id` | Unique stable ID |
| Asset scope through `location_id` | Must resolve to exactly one active inspection location |
| `thickness_value`, `thickness_unit` | Positive finite value; deterministically converted to mm |
| `method` | Approved technique name, not free-text inference |
| `procedure_id`, `procedure_revision` | Required for comparability |
| `instrument_id`, `calibration_ref` | Required and valid at event time |
| `measurement_uncertainty_mm` | Non-negative and traceable to the procedure |
| `event_time`, `ingested_at` | ISO 8601 with offset |
| `quality` | `good`, `suspect`, `bad`, `stale` or `missing` |
| `basis` | Must be `measured` |
| `source_system`, `source_ref`, `origin` | Complete provenance |

Recommended context: metal/surface temperature, couplant or mounting state, coating/insulation state, raw signal reference, inspector and comments. A procedure owner defines which context differences break comparability.

## Wireless sensor health/configuration event

Required fields: `record_id`, `sensor_id`, asset scope, `event_type`, `event_time`, `firmware_or_configuration_ref`, `quality`, `source_ref`.

`event_type` includes `installed`, `configuration_changed`, `calibration_checked`, `battery_low`, `connectivity_lost`, `connectivity_restored`, `removed` and `replaced`. Health events never substitute for a measured reading.

## Process sample

Required fields: `record_id`, asset/circuit scope, `tag`, `value` or explicit null, canonical `unit`, `quality`, `event_time`, `ingested_at` and provenance. Correlation requires a recorded time-alignment rule and does not establish cause.

## Engineer-entered limit and policy

Required fields: `record_id`, asset scope, `value`, `unit`, `limit_type`, `source_document`, `source_revision`, `entered_by`, `entered_at`, `approval_status`.

`t_min` and governing-rate policies are never extracted directly into an approved state. Model extraction may create a draft requiring engineer confirmation.

## Verification result

Required fields: `record_id`, `exception_id`, asset scope, approved method/procedure, measured findings, adjacent coverage, uncertainty, reviewer, event time and source reference. The result states whether it confirms, rejects or cannot resolve the suspected change.

## Rejection behavior

Rejected records are retained with reason codes such as `asset_ambiguous`, `location_unknown`, `unit_unsupported`, `method_missing`, `procedure_mismatch`, `calibration_invalid`, `timestamp_invalid`, `quality_not_usable` and `uncertainty_exceeds_change`. No adapter silently repairs or invents engineering data.

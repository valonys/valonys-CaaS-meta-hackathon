# Media-evidence validation report

Documentation recovery: 2026-10-22. **Status: PASS for required-output presence/count checks; prior media validation recorded PASS. Engineering/SME approval remains open.**

## Existing validation evidence

These results are reported from [validation_results.json](validation_results.json), supported by [source metadata](source_media.json), audio probe JSON and the existing execution log. No media validation script, extraction or source hashing was rerun during recovery.

- Source before/after SHA-256: `253eddc247b50614fb579094e902b861d69f75f16151411a0e57f72ce35ae38e`; size 2,262,042,532 bytes; mtime_ns 1792660859935603174. Recorded before/after values match and `source_unchanged` is true. This is the prior integrity result, not a fresh source check.
- AAC payload hash match: true. PCM decode hash match: true.
- Recorded image decode result: all images readable. Recovery did not repeat decoding or visual review.

| Audio output | Recorded duration | Difference from source audio | Format | Bytes |
|---|---:|---:|---|---:|
| `audio/EddyFi_UT_Wireless_full_audio.m4a` | 2789.610667 s | +0.000021 s | AAC, 48 kHz, stereo | 67,475,248 |
| `audio/EddyFi_UT_Wireless_transcription.wav` | 2789.610688 s | +0.000042 s | PCM s16le, 16 kHz, mono | 89,267,620 |

Both are approximately 46:29.611. Source audio is 2789.610646 s; video/container is 2789.900 s. The approximately 0.289 s shorter audio duration is present in the source, not evidence of extraction truncation. Both differences from source audio satisfy the original validator's 0.05 s tolerance.

## Recovery file checks

| Output | Recorded count | Current count | Result |
|---|---:|---:|---|
| Timeline JPEGs | 80 | 80 | PASS; target 80, cap 120 |
| Scene JPEGs | 46 | 46 | PASS; cap 80 |
| Poster candidate JPEGs | 18 | 18 | PASS; required 12–20; selected copies |
| Contact sheets | 8 | 8 | PASS; four timeline, three scene, one poster |
| Manifest data rows | 144 | 144 | PASS; unique paths, all present/non-empty |

The 144 manifest entries comprise 80 timeline + 46 scene + 18 poster-copy entries; contact sheets are separate. Timeline records span 0.000000–2789.866667 s, including the opening and last frame according to the existing extraction records. Sampling coverage does not guarantee capture of every slide or animation.

Recovery verified non-empty audio files with byte sizes matching validation metadata, all 152 JPEG files, all manifest-referenced files, and required documents/metadata: `README.md`, `proposal_evidence.md`, `poster_storyboard.md`, `base_case_outline.md`, `metadata/source_media_report.md`, `metadata/source_media.json`, `metadata/frame_manifest.csv`, `metadata/validation_results.json`, this report and `metadata/execution_log.md`. Existing probe, selection and extraction records and exact commands are retained. Empty extraction/validation stderr logs are expected and are not missing deliverables.

Only `README.md`, this report and appended execution/handoff notes were changed. Existing media, proposal documents, scripts and validation JSON were preserved. No source access, software installation or network use was needed.

## Open review and assurance boundaries

- Complete substantive audio review/transcription before attributing spoken claims; current evidence is visual and sampled.
- Confirm site assets, damage mechanisms, operating/design limits, equipment ratings (including the inconsistent hot-temperature unit pair), hazardous-area suitability and installation procedures.
- Establish calibrated baseline UT/spatial coverage, raw-data provenance, uncertainty, representativeness and competent acceptance criteria. Point readings do not establish full-wall condition.
- Confirm network/OT security, pilot quantity/duration, costs, KPI targets and benefits; these remain planning assumptions.
- Obtain image-use permissions, approved print graphics and SME wording review before poster publication; no finished poster is included.

Images alone cannot establish remaining wall thickness, corrosion rate, fitness-for-service or inspection acceptance. Final decisions require calibrated UT data, equipment validation, approved inspection procedures and competent-person review. Existing inspection obligations and operating limits remain in force; media validation is not engineering acceptance. See [proposal evidence](../proposal_evidence.md) and [base-case outline](../base_case_outline.md) for the full retained limitations.

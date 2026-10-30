# Wireless UT source assets

> Background-research media (video frames, audio, presentation deliverables) is kept outside this repository and is never used as demo inspection evidence. Paths below refer to a local source package.

## Preserved evidence root

Local source package: `$WIRELESS_UT_SOURCE_ROOT`

The source package remains the authoritative location for the complete extraction set: 80 timeline frames, 46 scene frames, 18 poster candidates, eight contact sheets, full audio, transcription-ready audio, extraction records and validation evidence. Files copied into this repository retain their source checksums.

## Large assets kept outside Git

| Asset | Local path | Bytes | SHA-256 | Handling |
| --- | --- | ---: | --- | --- |
| Original source video | external source video (not distributed) | 2,262,042,532 | `253eddc247b50614fb579094e902b861d69f75f16151411a0e57f72ce35ae38e` | Do not modify, recompress or commit |
| Full extracted audio | `$WIRELESS_UT_SOURCE_ROOT/audio/EddyFi_UT_Wireless_full_audio.m4a` | 67,475,248 | `721c7a9a946f794235caa345d1e23cab32e919dede5b64921585cadb3e4234a4` | Local evidence; do not commit |
| Transcription-ready audio | `$WIRELESS_UT_SOURCE_ROOT/audio/EddyFi_UT_Wireless_transcription.wav` | 89,267,620 | `f5a666fb1700c6213319c8df3f5e40423a38bfd4f3e40fe9461e1aea893e10a9` | Local evidence; do not commit |

These paths are workstation-local references. On another workstation, locate each asset by filename and verify the checksum before use.

## Editable poster artifact

The live editable poster is retained outside Git as artifact `artifact_gc_GSKdRzythKOhtIZXxeE46OMzvG7Hv`. The repository contains the exported PNG only. Publication still requires image-use permission and stakeholder approval.

## Source integrity status

The original evidence package's recorded validation reports matching source before/after hashes and unchanged size. This integration freshly recalculated the video and audio SHA-256 values on 28 October 2026 without modifying the files. The preserved source validation report is in `references/source_validation_report.md`.

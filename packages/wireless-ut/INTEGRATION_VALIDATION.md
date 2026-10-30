# Wireless UT package integration validation

Validation date: 28 October 2026 (Africa/Luanda)

## Result

**PASS for repository integration and readability.** Engineering approval, site verification, image-use permission and substantive audio review remain open.

## Source integrity

- Fresh SHA-256 of the unmodified 2,262,042,532-byte source video: `253eddc247b50614fb579094e902b861d69f75f16151411a0e57f72ce35ae38e`. This matches the supplied expected value and the preserved source validation record.
- Fresh SHA-256 of full AAC audio: `721c7a9a946f794235caa345d1e23cab32e919dede5b64921585cadb3e4234a4`.
- Fresh SHA-256 of transcription WAV: `f5a666fb1700c6213319c8df3f5e40423a38bfd4f3e40fe9461e1aea893e10a9`.
- The original video and audio were read for hashing only. They were not copied, modified or recompressed.

## Automated package checks

Command: `python3 tools/validate_package.py`

Result: `PASS: 9 media records, 16 claims, 3 deliverables, 2 framework JSON files, 23 local links`.

The validator confirmed:

- every included evidence image has exactly one media-manifest row;
- every media checksum and 1372 x 771 crop dimension matches the manifest;
- each repository image is byte-identical to its source-package image;
- all required provenance classes are present in the claim manifest and claim IDs are unique;
- DOCX/PDF/poster bytes and SHA-256 values match the deliverables manifest;
- the DOCX ZIP package is intact and contains `word/document.xml`;
- the PDF has a valid header and trailer;
- the poster is a valid 1584 x 1120 PNG; and
- all local links in the package's top-level Markdown files resolve.
- the project schema and base-case JSON parse, preserve the 3-5 circuit / 24-40 location / approximately nine-month assumptions, cite known claim IDs and explicitly contain no runtime measurements or media inputs.

## Visual readability review

- Rendered all 12 DOCX pages to PNG with the bundled `render_docx.py` workflow and inspected the complete page contact sheet.
- Rendered all 12 PDF pages with Poppler and inspected the complete page contact sheet.
- `pdfinfo` confirmed 12 US Letter pages, PDF 1.7 and 1,047,698 bytes.
- Inspected the 1584 x 1120 poster at original resolution.
- Inspected a contact sheet of all nine repository evidence images. Each crop removes the presenter tile while retaining the technical slide content and source footer. No clipping, overlap, broken glyphs or unreadable page layout was observed.

## External references

HTTP GET with redirect following returned status 200 for all eight proposal references checked on 28 October 2026: DNV-RP-G101 landing page, HSE offshore topics, both HSE PDF references, API mechanical-integrity PDF, AMPP CUI page, Emerson UT monitoring page and Inductosense WAND-TM page. A successful link check confirms reachability, not technical endorsement or currency of the underlying content.

## Open approvals and limitations

- The source audio has not been substantively transcribed or reviewed; no spoken claim is attributed by this package.
- Site age, leak history, candidate assets, damage mechanisms, process conditions, equipment ratings, hazardous-area suitability, radio design, cybersecurity, uncertainty and business-case values remain unverified.
- The refinery age narrative of more than 40 years remains commissioning-brief context, not a confirmed quotation.
- Presenter-free evidence crops are technically usable, but publication requires image-use approval.
- Proposal and poster remain drafts; this validation is not engineering acceptance.

#!/usr/bin/env python3
"""Validate the repository-sized Wireless UT evidence package.

This deliberately uses only the Python standard library so the audit can run in
CI without installing image or document tooling. Visual readability is a
separate human gate recorded in INTEGRATION_VALIDATION.md.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import struct
import sys
import zipfile
import os
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(os.environ.get("WIRELESS_UT_SOURCE_ROOT", "EddyFi_UT_Wireless_Base_Case"))


def fail(message: str) -> None:
    raise AssertionError(message)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def jpeg_dimensions(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if not data.startswith(b"\xff\xd8"):
        fail(f"not a JPEG: {path}")
    pos = 2
    sof_markers = set(range(0xC0, 0xC4)) | set(range(0xC5, 0xC8)) | set(range(0xC9, 0xCC)) | set(range(0xCD, 0xD0))
    while pos + 4 <= len(data):
        if data[pos] != 0xFF:
            pos += 1
            continue
        marker = data[pos + 1]
        pos += 2
        if marker in {0xD8, 0xD9}:
            continue
        if pos + 2 > len(data):
            break
        length = struct.unpack(">H", data[pos : pos + 2])[0]
        if marker in sof_markers:
            if pos + 7 > len(data):
                break
            height, width = struct.unpack(">HH", data[pos + 3 : pos + 7])
            return width, height
        if length < 2:
            break
        pos += length
    fail(f"JPEG dimensions not found: {path}")


def png_dimensions(path: Path) -> tuple[int, int]:
    data = path.read_bytes()[:24]
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        fail(f"not a PNG: {path}")
    return struct.unpack(">II", data[16:24])


def validate_media() -> int:
    manifest = ROOT / "manifests/media_manifest.csv"
    with manifest.open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream))
    if len(rows) != 9:
        fail(f"expected 9 media rows, found {len(rows)}")
    seen_ids: set[str] = set()
    seen_paths: set[str] = set()
    for row in rows:
        asset_id = row["asset_id"]
        rel_path = row["repo_path"]
        if asset_id in seen_ids or rel_path in seen_paths:
            fail(f"duplicate media identity: {asset_id} / {rel_path}")
        seen_ids.add(asset_id)
        seen_paths.add(rel_path)
        repo_file = ROOT / rel_path
        source_file = SOURCE_ROOT / row["source_package_path"]
        if not repo_file.is_file():
            fail(f"missing repository media: {repo_file}")
        if not source_file.is_file():
            fail(f"missing source media: {source_file}")
        actual_hash = sha256(repo_file)
        if actual_hash != row["sha256"]:
            fail(f"repository hash mismatch: {rel_path}")
        if sha256(source_file) != actual_hash:
            fail(f"source/copy mismatch: {rel_path}")
        dimensions = jpeg_dimensions(repo_file)
        expected = (int(row["width_px"]), int(row["height_px"]))
        if dimensions != expected:
            fail(f"dimension mismatch for {rel_path}: {dimensions} != {expected}")
    included = {str(path.relative_to(ROOT)) for path in (ROOT / "evidence/images").glob("*.jpg")}
    if included != seen_paths:
        fail(f"media manifest coverage mismatch: manifest={seen_paths}, included={included}")
    return len(rows)


def validate_claims() -> int:
    with (ROOT / "manifests/claims_manifest.csv").open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream))
    required_classes = {
        "source-derived observation",
        "commissioning brief",
        "engineering assumption",
        "engineering recommendation",
        "assurance limitation",
    }
    classes = {row["provenance_class"] for row in rows}
    if not required_classes.issubset(classes):
        fail(f"missing provenance classes: {sorted(required_classes - classes)}")
    ids = [row["claim_id"] for row in rows]
    if len(ids) != len(set(ids)):
        fail("duplicate claim IDs")
    for row in rows:
        if not all(row[field].strip() for field in row):
            fail(f"incomplete claim row: {row.get('claim_id')}")
    return len(rows)


def validate_deliverables() -> int:
    with (ROOT / "manifests/deliverables_manifest.csv").open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream))
    for row in rows:
        path = ROOT / row["repo_path"]
        if not path.is_file():
            fail(f"missing deliverable: {path}")
        if path.stat().st_size != int(row["bytes"]):
            fail(f"size mismatch: {path}")
        if sha256(path) != row["sha256"]:
            fail(f"hash mismatch: {path}")
    docx = ROOT / rows[0]["repo_path"]
    with zipfile.ZipFile(docx) as archive:
        if archive.testzip() is not None:
            fail("corrupt DOCX archive")
        if "word/document.xml" not in archive.namelist():
            fail("DOCX has no word/document.xml")
    pdf = ROOT / rows[1]["repo_path"]
    pdf_data = pdf.read_bytes()
    if not pdf_data.startswith(b"%PDF-") or b"%%EOF" not in pdf_data[-2048:]:
        fail("invalid PDF signature or trailer")
    poster = ROOT / rows[2]["repo_path"]
    if png_dimensions(poster) != (1584, 1120):
        fail("poster dimension mismatch")
    return len(rows)


def validate_framework() -> int:
    schema_path = ROOT / "framework/contracts/wireless-ut-project.schema.json"
    example_path = ROOT / "framework/examples/offshore-base-case.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    example = json.loads(example_path.read_text(encoding="utf-8"))
    if schema.get("properties", {}).get("source_role", {}).get("const") != "background_research_only":
        fail("framework schema must keep source media as background research only")
    if example.get("schema_version") != "1.0.0":
        fail("unexpected framework example schema version")
    if example.get("source_role") != "background_research_only":
        fail("base case must not classify research media as runtime evidence")
    runtime = example.get("runtime_data", {})
    if runtime != {"status": "not_provided", "measurement_records": 0, "site_verified": False}:
        fail("base case must not contain or imply site measurements")
    planning = example.get("planning_basis", {})
    expected_planning = {
        "circuits_min": 3,
        "circuits_max": 5,
        "locations_min": 24,
        "locations_max": 40,
        "duration_months_approx": 9,
        "monitored_operation_months_min": 6,
    }
    if planning != expected_planning:
        fail("base-case planning assumptions changed without contract review")
    with (ROOT / "manifests/claims_manifest.csv").open(newline="", encoding="utf-8") as stream:
        known_claims = {row["claim_id"] for row in csv.DictReader(stream)}
    unknown_claims = set(example.get("assumption_claim_ids", [])) - known_claims
    if unknown_claims:
        fail(f"framework example cites unknown claims: {sorted(unknown_claims)}")
    serialized = json.dumps(example).lower()
    if any(token in serialized for token in ["evidence/images", ".jpg", ".mp4", ".m4a", ".wav"]):
        fail("framework example must not include presentation media as runtime input")
    return 2


def validate_markdown_links() -> int:
    checked = 0
    link_pattern = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")
    markdown_files = list(ROOT.glob("*.md")) + list((ROOT / "framework").glob("*.md"))
    for markdown in sorted(markdown_files):
        for raw_target in link_pattern.findall(markdown.read_text(encoding="utf-8")):
            target = raw_target.strip().split("#", 1)[0]
            if not target or re.match(r"^[a-z][a-z0-9+.-]*://", target, re.I):
                continue
            resolved = (markdown.parent / unquote(target)).resolve()
            if not resolved.exists():
                fail(f"broken local link in {markdown.name}: {raw_target}")
            checked += 1
    return checked


def main() -> int:
    media = validate_media()
    claims = validate_claims()
    deliverables = validate_deliverables()
    framework = validate_framework()
    links = validate_markdown_links()
    print(
        f"PASS: {media} media records, {claims} claims, "
        f"{deliverables} deliverables, {framework} framework JSON files, "
        f"{links} local links"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, csv.Error, json.JSONDecodeError, OSError, zipfile.BadZipFile) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1)

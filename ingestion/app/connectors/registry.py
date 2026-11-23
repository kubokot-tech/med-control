"""
Built-in laboratory parsers. Each connector module exposes:
  META        dict: id (unique, stored in ingest_documents.source), name, country, description, fallback (bool)
  detect(text) -> bool     does this text layer look like this lab's report
  parse_text(text) -> dict {"lab_name", "doc_date" (YYYY-MM-DD or None), "observations": [{test_name, result_text,
                            result_num, units, ref_text, ref_low, ref_high}]}
Parsers work on the text pypdf extracts, so tests need no PDF files (see docs/LAB-PARSERS.md).
"""
from __future__ import annotations

from types import ModuleType

from . import dnkom_pdf_v1, hadassah_pdf_v1, helix_pdf_v1, helix_pdf_v2, mknc_pdf_v1

# Order matters: specific detectors first; fallback parsers are tried last on documents nobody claims.
# helix_pdf_v2 (the new layout) before helix_pdf_v1: on old documents only v1 detects.
PARSERS: list[ModuleType] = [helix_pdf_v2, helix_pdf_v1, hadassah_pdf_v1, dnkom_pdf_v1, mknc_pdf_v1]


def by_id(pid: str) -> ModuleType | None:
    return next((p for p in PARSERS if p.META["id"] == pid), None)


def candidates(text: str) -> list[ModuleType]:
    """Parsers to try for this text: those that detect it, then fallbacks."""
    hit = [p for p in PARSERS if p.detect(text)]
    fallback = [p for p in PARSERS if p.META.get("fallback") and p not in hit]
    return hit + fallback


def public_list() -> list[dict]:
    return [{k: p.META[k] for k in ("id", "name", "country", "description")} for p in PARSERS]

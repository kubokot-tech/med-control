from __future__ import annotations

from pydantic import BaseModel
from typing import Optional


class ExtractedObservation(BaseModel):
    test_name_raw: str
    result_text: Optional[str] = None
    result_num: Optional[float] = None
    unit_raw: Optional[str] = None
    ref_text_raw: Optional[str] = None
    ref_low: Optional[float] = None
    ref_high: Optional[float] = None


class IngestLabsResponse(BaseModel):
    source: str
    lab_name: Optional[str] = None
    doc_date: Optional[str] = None  # YYYY-MM-DD
    sha256: str
    observations: list[ExtractedObservation]

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Iterable

from pypdf import PdfReader


@dataclass
class ParsedObservation:
    test_name: str
    result_text: str | None
    result_num: float | None
    ref_text: str | None
    ref_low: float | None
    ref_high: float | None
    deviation_text: str | None
    criticality_text: str | None
    units: str | None


@dataclass
class ParsedDocument:
    sha256: str
    filename: str
    lab_name: str | None
    doc_date: date | None
    observations: list[ParsedObservation]


NUM_RE = re.compile(r"^[-+]?\d+[\.,]?\d*$")
UNIT_RE = re.compile(
    r"(ммоль/л|мМоль/л|мкмоль/л|г/л|г/дл|мг/дл|мг/л|мкг/л|ЕД/л|ед/л|единицы\s*рН|отн\.ед\.|фл|пг|%|10\^\d+\/л|×\s*10\^\d+\/л|количество\/мкл)",
    re.I,
)


def _to_float(s: str) -> float | None:
    s = s.strip().replace(" ", "")
    if not s:
        return None
    s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _parse_ref_range(ref_text: str | None) -> tuple[float | None, float | None]:
    if not ref_text:
        return None, None
    m = re.match(r"\s*([-+]?\d+[\.,]?\d*)\s*-\s*([-+]?\d+[\.,]?\d*)\s*$", ref_text)
    if not m:
        return None, None
    return _to_float(m.group(1)), _to_float(m.group(2))


def extract_text_from_pdf(path: str) -> str:
    r = PdfReader(path)
    return "\n".join((p.extract_text() or "") for p in r.pages)


def parse_document(path: str, filename: str) -> ParsedDocument:
    with open(path, "rb") as f:
        blob = f.read()
    sha = hashlib.sha256(blob).hexdigest()

    text = extract_text_from_pdf(path)
    doc = parse_text(text, filename)
    doc.sha256 = sha
    return doc


def parse_text(text: str, filename: str = "") -> ParsedDocument:
    """Parse the text layer (as pypdf extracts it) of an MKNC report."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    # meta
    m_date = re.search(r"Дата:\s*(\d{2}\.\d{2}\.\d{4})", text)
    doc_date = None
    if m_date:
        doc_date = datetime.strptime(m_date.group(1), "%d.%m.%Y").date()

    m_lab = re.search(r"ГБУЗ\s+«([^»]+)»", text)
    lab_name = m_lab.group(1).replace("\n", " ").strip() if m_lab else None

    observations = _parse_table(lines)
    observations = _cleanup_observations(text, observations)

    return ParsedDocument(
        sha256="",
        filename=filename,
        lab_name=lab_name,
        doc_date=doc_date,
        observations=observations,
    )


def _cleanup_observations(raw_text: str, obs: list[ParsedObservation]) -> list[ParsedObservation]:
    # Special cleanup for urinalysis PDFs (ОАМ) where qualitative fields may stick to neighbors.
    if "Клинический анализ мочи" not in raw_text:
        return obs

    out: list[ParsedObservation] = []

    for o in obs:
        name = (o.test_name or "").strip()

        # Fix missing name for urobilin row in our sample (result 17, ref 0-34, mкмоль/л)
        if not name and (o.ref_text or "").strip() == "0 - 34" and (o.units or "").lower() == "мкмоль/л":
            name = "Уробилин качественно"
            o = ParsedObservation(
                test_name=name,
                result_text=o.result_text,
                result_num=o.result_num,
                ref_text=o.ref_text,
                ref_low=o.ref_low,
                ref_high=o.ref_high,
                deviation_text=o.deviation_text,
                criticality_text=o.criticality_text,
                units=o.units,
            )

        # Split: "Прозрачность <value> ... Удельный вес" got merged into name and ud.ves moved to result.
        if name.lower().startswith("прозрачность") and "удельный вес" in name.lower():
            m = re.search(r"прозрачность\s+(.*?)\s+удельный\s+вес", name, re.I)
            transparency_val = m.group(1).strip() if m else None
            if transparency_val:
                out.append(
                    ParsedObservation(
                        test_name="Прозрачность",
                        result_text=transparency_val,
                        result_num=None,
                        ref_text=None,
                        ref_low=None,
                        ref_high=None,
                        deviation_text=None,
                        criticality_text=None,
                        units=None,
                    )
                )
            # Rename current to specific test
            o = ParsedObservation(
                test_name="Удельный вес",
                result_text=o.result_text,
                result_num=o.result_num,
                ref_text=o.ref_text,
                ref_low=o.ref_low,
                ref_high=o.ref_high,
                deviation_text=o.deviation_text,
                criticality_text=o.criticality_text,
                units=o.units,
            )
            out.append(o)
            continue

        # Split: "Цвет <value> ... Кровь полуколичествено" merged.
        if name.lower().startswith("цвет") and "кровь" in name.lower():
            m = re.search(r"цвет\s+(.*?)\s+кровь", name, re.I)
            color_val = m.group(1).strip() if m else None
            if color_val:
                out.append(
                    ParsedObservation(
                        test_name="Цвет",
                        result_text=color_val,
                        result_num=None,
                        ref_text=None,
                        ref_low=None,
                        ref_high=None,
                        deviation_text=None,
                        criticality_text=None,
                        units=None,
                    )
                )
            o = ParsedObservation(
                test_name="Кровь полуколичественно",
                result_text=o.result_text,
                result_num=o.result_num,
                ref_text=o.ref_text,
                ref_low=o.ref_low,
                ref_high=o.ref_high,
                deviation_text=o.deviation_text,
                criticality_text=o.criticality_text,
                units=o.units,
            )
            out.append(o)
            continue

        # Normalize qualitative fields if parser glued status text into the name
        low_name = name.lower()
        if low_name.startswith("прозрачность") and (o.result_text is None or str(o.result_text).strip() == ""):
            # try to extract value from the name
            m = re.search(r"прозрачность\s+(.*?)(?:\s+отклонение\b|\s+ненормальный\b|$)", name, re.I)
            val = m.group(1).strip() if m else None
            if val:
                o = ParsedObservation(
                    test_name="Прозрачность",
                    result_text=val,
                    result_num=None,
                    ref_text=None,
                    ref_low=None,
                    ref_high=None,
                    deviation_text=None,
                    criticality_text=None,
                    units=None,
                )
        elif low_name.startswith("цвет") and (o.result_text is None or str(o.result_text).strip() == ""):
            m = re.search(r"цвет\s+(.*?)(?:\s+отклонение\b|\s+ненормальный\b|$)", name, re.I)
            val = m.group(1).strip() if m else None
            if val:
                o = ParsedObservation(
                    test_name="Цвет",
                    result_text=val,
                    result_num=None,
                    ref_text=None,
                    ref_low=None,
                    ref_high=None,
                    deviation_text=None,
                    criticality_text=None,
                    units=None,
                )

        # If qualitative got parsed into result_text, strip status tail.
        if o.test_name in {"Прозрачность", "Цвет"} and o.result_text:
            m = re.search(r"^(.*?)(?:\s+отклонение\b|\s+ненормальный\b|$)", o.result_text, re.I)
            val = m.group(1).strip() if m else o.result_text.strip()
            o = ParsedObservation(
                test_name=o.test_name,
                result_text=val,
                result_num=None,
                ref_text=None,
                ref_low=None,
                ref_high=None,
                deviation_text=None,
                criticality_text=None,
                units=None,
            )

        out.append(o)

    return out


def _parse_table(lines: list[str]) -> list[ParsedObservation]:
    def is_start_of_test(idx: int) -> bool:
        if idx < 0 or idx >= len(lines) - 1:
            return False
        a, b = lines[idx], lines[idx + 1]
        if not a or a in {"-", "Тест", "Результат", "Норма", "Отклонение", "Критичность"}:
            return False
        if a.startswith("Исполнитель"):
            return False
        return (not NUM_RE.match(a)) and bool(NUM_RE.match(b))

    try:
        h = lines.index("Тест")
    except ValueError:
        return []

    i = h + 1
    header_like = {"Результат", "Норма", "Отклонение", "Критичность", "отклонения", "Ед. изм.", "Ед.", "изм."}
    while i < len(lines) and lines[i] in header_like:
        i += 1

    out: list[ParsedObservation] = []

    while i < len(lines):
        if lines[i].startswith("Исполнитель"):
            break

        # test name (can be multiline)
        name_parts: list[str] = []
        while i < len(lines) and not NUM_RE.match(lines[i]):
            if lines[i].startswith("Исполнитель"):
                break
            # stop if we somehow hit units (rare PDF artifacts)
            if UNIT_RE.search(lines[i]) and is_start_of_test(i + 1):
                break
            name_parts.append(lines[i])
            i += 1

        if i >= len(lines) or lines[i].startswith("Исполнитель"):
            break

        test_name = " ".join(name_parts).strip()
        result_text = lines[i]
        i += 1

        ref_text = lines[i] if i < len(lines) else None
        i += 1

        # deviation (often '-' or short text)
        deviation_text: str | None
        if i < len(lines) and lines[i] == "-":
            deviation_text = "-"
            i += 1
        else:
            dev_parts: list[str] = []
            while i < len(lines):
                if lines[i].startswith("Исполнитель"):
                    break
                if lines[i] == "-" or lines[i].startswith("Ненормальный") or UNIT_RE.search(lines[i]) or is_start_of_test(i):
                    break
                dev_parts.append(lines[i])
                i += 1
                if len(dev_parts) > 6:
                    break
            deviation_text = " ".join(dev_parts).strip() if dev_parts else "-"

        # criticality (often '-' or startswith 'Ненормальный ...')
        criticality_text: str | None
        if i < len(lines) and lines[i] == "-":
            criticality_text = "-"
            i += 1
        elif i < len(lines) and lines[i].startswith("Ненормальный"):
            crit_parts: list[str] = []
            while i < len(lines):
                if lines[i].startswith("Исполнитель"):
                    break
                if UNIT_RE.search(lines[i]) or is_start_of_test(i):
                    break
                crit_parts.append(lines[i])
                i += 1
                if len(crit_parts) > 12:
                    break
            criticality_text = " ".join(crit_parts).strip() if crit_parts else "-"
        else:
            criticality_text = "-"

        # units (best-effort)
        units = lines[i] if i < len(lines) else None
        if units and not UNIT_RE.search(units):
            # misalignment: don't consume what looks like next test name
            if is_start_of_test(i):
                units = None
            else:
                # allow unknown unit but still consume one token
                pass
        i += 1

        result_num = _to_float(result_text)
        ref_low, ref_high = _parse_ref_range(ref_text)

        out.append(
            ParsedObservation(
                test_name=test_name,
                result_text=result_text,
                result_num=result_num,
                ref_text=ref_text,
                ref_low=ref_low,
                ref_high=ref_high,
                deviation_text=deviation_text,
                criticality_text=criticality_text,
                units=units,
            )
        )

    return out

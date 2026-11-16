"""MKNC (Moscow clinical scientific centre) laboratory reports: one value per line under a «Тест» header."""
from __future__ import annotations

from dataclasses import asdict

from ..vendor.labs_parse_pdf import parse_text as _parse_text

META = {
    "id": "mknc_pdf_v1",
    "name": "МКНЦ им. А. С. Логинова",
    "country": "RU",
    "description": "Бланки лабораторной информационной системы МКНЦ: кровь, биохимия, моча. Таблица «Тест / Результат / Норма / Отклонение / Ед. изм.»",
    # Tried for any PDF no other parser claims: its table layout is generic enough to catch similar LIS printouts.
    "fallback": True,
}


def detect(text: str) -> bool:
    lines = [ln.strip() for ln in text.splitlines()]
    return "Тест" in lines and any(ln.startswith("Исполнитель") for ln in lines)


def parse_text(text: str) -> dict:
    doc = _parse_text(text)
    return {
        "lab_name": doc.lab_name,
        "doc_date": doc.doc_date.isoformat() if doc.doc_date else None,
        "observations": [asdict(o) for o in doc.observations],
    }

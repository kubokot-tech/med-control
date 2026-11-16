"""DNKOM laboratory reports: a table per panel, «Показатель Результат Референсные значенияЕд. изм.».

The unit is glued to the reference («5,0 - 21,0мкмоль/л», «4,30 - 5,5710^12/л») and may wrap to the next line
(«нмоль/ммоль» then «креатинина»). A table can run over a page break, without a repeated header. Comments and notes
after a table hold numbers too, so rows only count while a table is open. The automatic formula lists the same names
twice, absolute and relative: «Нейтрофилы (NEU)» becomes «Нейтрофилы, абс.» or «Нейтрофилы, %» by its unit.
"""
from __future__ import annotations

import re
from datetime import datetime

META = {
    "id": "dnkom_pdf_v1",
    "name": "ДНКОМ",
    "country": "RU",
    "description": "Бланки лаборатории ДНКОМ: кровь, биохимия, гормоны, онкомаркеры, аутоантитела.",
    "fallback": False,
}

N = r"[0-9]+(?:[.,][0-9]+)?"
RES = rf"[<>≤≥]? ?{N}"
REF = rf"{N} ?- ?{N}|[<>≤≥] ?{N}"
ROW = re.compile(rf"^(?P<name>.+?) (?P<res>{RES}) (?P<ref>{REF})(?P<unit>.*)$")
# «10^9/л» glued to a reference that ends in digits: cut it off first, or it reads as part of the number
POWER = re.compile(r"10\^[0-9]+/\S+$")
UNIT_TAIL = re.compile(r"^[а-яё]+$")
FORMULA = re.compile(r"^(Нейтрофилы|Эозинофилы|Базофилы|Моноциты|Лимфоциты|Незрелые гранулоциты|Нормобласты) \(.+\)$")
HEADER = "Показатель Результат"
TABLE_END = ("Комментарии к пробе", "Примечание", "Исследования выполнены", "Результаты одобрил")


def _to_float(s: str | None):
    try:
        return float((s or "").replace(",", "."))
    except ValueError:
        return None


def _ref_bounds(ref: str):
    m = re.fullmatch(rf"({N}) ?- ?({N})", ref)
    if m:
        return _to_float(m.group(1)), _to_float(m.group(2))
    m = re.fullmatch(rf"[<≤] ?({N})", ref)
    if m:
        return None, _to_float(m.group(1))
    m = re.fullmatch(rf"[>≥] ?({N})", ref)
    if m:
        return _to_float(m.group(1)), None
    return None, None


def _name(raw: str, unit: str | None) -> str:
    name = raw.rstrip("* ")
    m = FORMULA.match(name)
    if not m:
        return name
    return f"{m.group(1)}, %" if unit == "%" else f"{m.group(1)}, абс."


def _rows(text: str) -> list[dict]:
    rows: list[dict] = []
    in_table = False
    last = None
    for raw in text.splitlines():
        line = " ".join(raw.split())
        if not line:
            continue
        if line.startswith(HEADER):
            in_table = True
            last = None
            continue
        if line.startswith(TABLE_END):
            in_table = False
            last = None
            continue
        if not in_table:
            continue
        if last is not None and UNIT_TAIL.match(line):
            last["units"] = f'{last["units"]} {line}' if last["units"] else line
            last = None
            continue
        power = POWER.search(line)
        m = ROW.match(line[: power.start()] if power else line)
        if not m:
            last = None
            continue
        low, high = _ref_bounds(m.group("ref"))
        unit = (power.group(0) if power else m.group("unit").strip()) or None
        last = {
            "test_name": _name(m.group("name"), unit),
            "result_text": m.group("res"),
            "result_num": _to_float(m.group("res")),
            "units": unit,
            "ref_text": m.group("ref"),
            "ref_low": low,
            "ref_high": high,
        }
        rows.append(last)
    return rows


def detect(text: str) -> bool:
    return "ДНКОМ" in text and HEADER in text


def parse_text(text: str) -> dict:
    doc_date = None
    m = re.search(r"(?:Взятие|Регистрация) биоматериала: ?([0-9]{2}\.[0-9]{2}\.[0-9]{4})", text)
    if m:
        try:
            doc_date = datetime.strptime(m.group(1), "%d.%m.%Y").date().isoformat()
        except ValueError:
            doc_date = None
    return {"lab_name": "ДНКОМ", "doc_date": doc_date, "observations": _rows(text)}

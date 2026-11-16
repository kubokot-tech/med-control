"""Hadassah Medical Moscow laboratory reports, two layouts.

Table layout («Наименование Результат [Референсное значение]»): one row per test, the name often wrapped over several
lines, then on the last line the result, the reference range and the unit glued to it («163 130 - 168г/л»), sometimes a
↑/↓ flag. The leukocyte formula is a wider table with an absolute and a relative value per cell type. Superscripts are
lost in the text layer: «*109 кл/л» is 10^9/л. Qualitative tables (blood group, antibodies) have no reference column.

List layout («Результаты лабораторных исследований»): one row per line, «name result unit reference»; a reference that
goes on («соломенно-желтый, желтый, светло-»), or a unit split («3,40 *10^3» / «кл/мл» / «0,00 - 10,00»), continues on the
next lines. Section titles («Анализ мочи общий») stand on their own line; urine rows get « (моча)» so that «Глюкоза» or
«Билирубин» of a urinalysis do not land in the blood series.
"""
from __future__ import annotations

import re
from datetime import datetime

META = {
    "id": "hadassah_pdf_v1",
    "name": "Хадасса Медикал (Москва)",
    "country": "RU",
    "description": "Бланки клинико-диагностической лаборатории: кровь, коагулограмма, иммуногематология, биохимия, общий анализ мочи. Таблица «Наименование / Результат / Референсное значение» и список «Результаты лабораторных исследований»",
    "fallback": False,
}

_N = r"[0-9]+(?:[.,][0-9]+)?"
_RES = rf"[<>≤≥]?{_N}"
_RANGE = rf"{_N} ?- ?{_N}"
# qualitative results: detection, sign, clarity, colour, Rh phenotype, ABO group
_QUAL = (
    r"(?:не )?(?:обнаружен[аоы]?|выявлен[аоы]?)|(?:слабо)?(?:отрицательн|положительн)(?:о|ый|ая|ое|ые)"
    r"|сомнительн(?:о|ый|ая|ое)|прозрачн(?:ая|ый|ое)|(?:слабо |слегка )?мутн(?:ая|ый|ое)"
    r"|(?:[а-яё]+-)?(?:желт|оранжев|красн|бур|коричнев|зелен|бесцветн|розов|янтарн)[а-яё]*|следы|\+{1,4}"
    r"|[c]{2}d{0,2}e{2}|(?:0|o|a|b|ab) ?\((?:i|ii|iii|iv)\)"
)
# name (may be empty: it was on the previous lines), result, reference (range or bound), unit glued to the reference
_ROW = re.compile(rf"^(?:(?P<name>.*\S) )?(?P<res>{_RES}) (?P<ref>{_RANGE}|[<>≤≥] ?{_N}|до {_N})(?P<unit> ?[^0-9 ].*)?$")
# a single number as the reference («Нормобласты 0,00 0*109 кл/л») only counts with a unit after it
_ROW_ONE = re.compile(rf"^(?:(?P<name>.*\S) )?(?P<res>{_RES}) (?P<ref>{_N})(?P<unit> ?[^0-9 .,].*)$")
# leukocyte formula: absolute value and range, relative value and range
_FORMULA = re.compile(rf"^(?P<name>.*\S) (?P<abs>{_N}) (?P<absref>{_RANGE}) (?P<pct>{_N}) (?P<pctref>{_RANGE})$")
# qualitative row: «Kell антиген (К) Отрицательный», optionally the expected value after it
_QROW = re.compile(rf"^(?:(?P<name>.*?\S) )?(?P<res>{_QUAL})(?: (?P<ref>{_QUAL}))?$", re.I)

# list layout: the reference is a range, a bound, a number or a text («Не нормировано», «Не обнаружено», a colour list)
_L_REF = rf"{_RANGE}|[<>≤≥] ?{_N}|до {_N}|{_N}|не нормировано|(?:{_QUAL})(?:,.*)?"
_L_NUM = re.compile(
    rf"^(?P<name>.+?) (?P<res>[<>≤≥]? ?{_N}) (?:(?P<unit>\*10\^?[0-9]+ \S+|[^\s0-9<>≤≥]\S*) )?(?P<ref>{_L_REF})$", re.I
)
_L_TXT = re.compile(rf"^(?P<name>.+?) (?P<res>{_QUAL})(?: (?P<unit>[^\s()]*/[^\s()]*|-))? (?P<ref>{_L_REF})$", re.I)
# a row cut short: name and result, maybe the first word of the unit, the rest on the next lines
_L_PARTIAL = re.compile(rf"^.+? [<>≤≥]? ?{_N}(?: \S+)?$")

_POWER = re.compile(r"^\*10\^?([0-9]{1,2}) ?кл/(л|мл|мкл)$")


def _to_float(s: str | None):
    s = (s or "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _ref_bounds(ref: str | None):
    ref = ref or ""
    m = re.match(rf"^({_N}) ?- ?({_N})$", ref)
    if m:
        return _to_float(m.group(1)), _to_float(m.group(2))
    m = re.match(rf"^(?:[<≤]|до) ?({_N})$", ref)
    if m:
        return None, _to_float(m.group(1))
    m = re.match(rf"^[>≥] ?({_N})$", ref)
    if m:
        return _to_float(m.group(1)), None
    return None, None


def _unit(raw: str | None):
    u = (raw or "").strip()
    m = _POWER.match(u)
    if m:
        return f"10^{m.group(1)}/{m.group(2)}"
    return None if u in ("", "-") else u


def _obs(name: str, res: str, ref: str | None, unit: str | None) -> dict:
    low, high = _ref_bounds(ref)
    return {
        "test_name": name,
        "result_text": res,
        "result_num": _to_float(res),
        "units": unit,
        "ref_text": ref,
        "ref_low": low,
        "ref_high": high,
    }


def _clean(raw: str) -> str:
    return " ".join(raw.replace("↑", " ").replace("↓", " ").split())


def _ends_name(line: str) -> bool:
    """Lines that end a name being collected: table headers, «Ключ: значение» header lines, the page footer."""
    return (
        ":" in line
        or line.startswith("Наименование")
        or "История результата" in line
        or line.startswith("Филиал компании")
        or line.endswith((".", ","))
        or re.match(r"^[0-9]+ из [0-9]+$", line) is not None
    )


def _parse_table(text: str) -> list[dict]:
    observations: list[dict] = []
    pending: list[str] = []
    for raw in text.splitlines():
        line = _clean(raw)
        if not line:
            continue
        f = _FORMULA.match(line)
        if f:
            name = " ".join(pending + [f.group("name")])
            observations.append(_obs(f"{name}, абс.", f.group("abs"), f.group("absref"), "10^9/л"))
            observations.append(_obs(f"{name}, %", f.group("pct"), f.group("pctref"), "%"))
            pending = []
            continue
        r = (_ROW.match(line) or _ROW_ONE.match(line) or _QROW.match(line)) if ":" not in line else None
        if r:
            name = " ".join(pending + ([r.group("name")] if r.group("name") else []))
            if name:
                observations.append(_obs(name, r.group("res"), r.group("ref"), _unit(r.groupdict().get("unit"))))
            pending = []
            continue
        if _ends_name(line):
            pending = []
        else:
            pending = (pending + [line])[-4:]
    return observations


def _parse_list(text: str) -> list[dict]:
    lines = [_clean(x) for x in text.splitlines()]
    start = next((i + 1 for i, x in enumerate(lines) if x.startswith("Результаты лабораторных исследований")), len(lines))
    observations: list[dict] = []
    section = ""
    i = start
    while i < len(lines):
        line = lines[i]
        i += 1
        if not line or ":" in line:
            continue
        # a reference list that goes on: «соломенно-желтый,» / «желтый, светло-» / «желтый»
        while line.endswith((",", "-")) and i < len(lines) and lines[i] and ":" not in lines[i]:
            line = line + lines[i] if line.endswith("-") else f"{line} {lines[i]}"
            i += 1
        m = _L_NUM.match(line) or _L_TXT.match(line)
        if not m and _L_PARTIAL.match(line):
            for k in (1, 2):
                if i + k > len(lines) or any(not x or ":" in x for x in lines[i : i + k]):
                    break
                m = _L_NUM.match(" ".join([line, *lines[i : i + k]]))
                if m:
                    i += k
                    break
        if not m:
            section = line
            continue
        name = m.group("name")
        if "моч" in section.lower() and "моч" not in name.lower():
            name = f"{name} (моча)"
        observations.append(_obs(name, m.group("res"), m.group("ref"), _unit(m.group("unit"))))
    return observations


def detect(text: str) -> bool:
    return "Хадасса" in text and ("Наименование Результат" in text or "Результаты лабораторных исследований" in text)


def parse_text(text: str) -> dict:
    doc_date = None
    m = re.search(r"(?:Дата взятия образца|Дата/время забора): ?([0-9]{2}\.[0-9]{2}\.[0-9]{4})", text)
    if m:
        try:
            doc_date = datetime.strptime(m.group(1), "%d.%m.%Y").date().isoformat()
        except ValueError:
            doc_date = None
    observations = _parse_table(text) if "Наименование Результат" in text else _parse_list(text)
    return {"lab_name": "Хадасса", "doc_date": doc_date, "observations": observations}

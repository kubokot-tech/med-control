"""Helix personal-account reports, the new layout (helix_pdf_v1 keeps the old one, see docs/LAB-PARSERS.md «Версии»).

What changed against v1: units sit next to each value instead of an «Ед. изм.» column, values carry ▲/▼
deviation markers, and a «Предыдущий результат» column adds a second value+unit pair to the row; the date of
that previous result («от 12.01.26») and the reference («<38») sit on the two following lines. detect() tells
the layouts apart by the table header: the new one has no «Ед. изм.» column.
"""
from __future__ import annotations

import re
from datetime import datetime

# A value token: an optional ▲/▼ deviation marker, an optional <,> comparator, then a number.
_MARKER = "▲▼↑↓"
_VALUE = re.compile(r"^[▲▼↑↓]?[<>]?[-+]?\d+[.,]?\d*$")
# units typical in Helix outputs
_UNIT = re.compile(
    r"(ммоль/л|мкмоль/л|мкМЕ/мл|пмоль/л|нмоль/л|мМЕ/л|МЕ/л|г/л|мг/л|мкг/л|нг/мл|пг/мл|ед/л|Ед/л|сек|%|\*10\^\d+/л|fL|пг|мм/ч|мл/мин/1,73м\^2)",
    re.I,
)
# «от 12.01.26»: the date of the previous result, on the line after the row
_PREV_DATE = re.compile(r"^от\s+\d{2}\.\d{2}\.\d{2,4}\s*$")
# a line that is only a reference: «<38», «9 - 64», «0.35 - 4.9»
_REF_LINE = re.compile(r"^[<>]?\s*[-+]?\d+[.,]?\d*(?:\s*-\s*[-+]?\d+[.,]?\d*)?\s*$")


def _to_float(s: str):
    s = (s or "").strip().replace(" ", "").replace(",", ".")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_ref(ref: str | None):
    if not ref:
        return None, None
    ref = ref.strip()
    m = re.match(r"^\s*([-+]?\d+[\.,]?\d*)\s*-\s*([-+]?\d+[\.,]?\d*)\s*$", ref)
    if m:
        return _to_float(m.group(1)), _to_float(m.group(2))
    m = re.match(r"^\s*<\s*([-+]?\d+[\.,]?\d*)\s*$", ref)
    if m:
        return None, _to_float(m.group(1))
    m = re.match(r"^\s*>\s*([-+]?\d+[\.,]?\d*)\s*$", ref)
    if m:
        return _to_float(m.group(1)), None
    return None, None


def _lines(text: str) -> list[str]:
    text = text.replace("\u00a0", " ")
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


# Patient header: "Фамилия Имя Отчество" (three capitalised Cyrillic words, optionally followed by a date of birth).
_PERSON_RE = re.compile(r"^[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s|,|$)")
# The new header prints the name in capitals with «(Муж., …)» / «(Жен., …)» after it.
_PERSON_CAPS_RE = re.compile(r"^[А-ЯЁ][а-яёА-ЯЁ-]*\s+[А-ЯЁ][а-яёА-ЯЁ-]*\s+[А-ЯЁ][а-яёА-ЯЁ-]*\s*\(")


def _is_noise(line: str) -> bool:
    low = line.lower().strip()
    # headers / person
    if _PERSON_RE.match(line.strip()) or _PERSON_CAPS_RE.match(line.strip()):
        return True
    if "(муж." in low or "(жен." in low:
        return True
    if low.startswith("пациент") or low.startswith("дата рождения") or low.startswith("пол:"):
        return True
    if low.startswith("перейти в личный кабинет"):
        return True
    if low.startswith("заказ") or "заказ №" in low:
        return True
    if low.startswith("зарегистрирован"):
        return True
    if low.startswith("заказчик"):
        return True
    if low.startswith("место взятия") or low.startswith("образец"):
        return True
    if low.startswith("вид материала"):
        return True
    # sample line: «Венозная кровь, № 1112223334, валидация 05.03.2026 18:20:00 *»
    if "№" in line and "валидация" in low:
        return True
    if low.startswith("регистрация") or low.startswith("валидация"):
        return True
    if low.startswith("подтверждение") or low.startswith("подлинности"):
        return True
    if low.startswith("* время указано"):
        return True
    if low.startswith("** референс"):
        return True
    if low.startswith("персональные данные"):
        return True
    if low.startswith("результаты анализов"):
        return True
    if low.startswith("интерпретацию"):
        return True
    if "в совокупности с данными анамнеза" in low:
        return True
    if low.startswith("отчет создан") or low.startswith("страница"):
        return True
    return False


def _looks_unit(tok: str) -> bool:
    return bool(_UNIT.search(tok)) or "/" in tok or "^" in tok or "%" in tok


def _extract_ref_from_text(t: str) -> str | None:
    if not t:
        return None
    m = re.search(r"([-+]?\d+[\.,]?\d*)\s*-\s*([-+]?\d+[\.,]?\d*)", t)
    if m:
        return f"{m.group(1)} - {m.group(2)}"
    m = re.search(r"<\s*([-+]?\d+[\.,]?\d*)", t)
    if m:
        return f"<{m.group(1)}"
    m = re.search(r">\s*([-+]?\d+[\.,]?\d*)", t)
    if m:
        return f">{m.group(1)}"
    return None


def _ref_on_following_lines(lines: list[str], i: int) -> str | None:
    """The reference under the row: the next line, or the one after the previous-result date («от 12.01.26»).
    Only a line that is nothing but a reference counts, so the next row's numbers are never picked up."""
    for j in range(i + 1, min(i + 3, len(lines))):
        nxt = lines[j]
        if _PREV_DATE.match(nxt.lower().strip()):
            continue
        if _REF_LINE.match(nxt):
            return _extract_ref_from_text(nxt)
        break
    return None


_GENERIC_LABELS = {
    "активность",
    "концентрация",
    "время",
    "расчет",
    "результат",
    "доля",
    "доля,%",
    "доля, %",
}


META = {
    "id": "helix_pdf_v2",
    "name": "Хеликс (новые бланки)",
    "country": "RU",
    "description": "Новые бланки личного кабинета «Хеликс»: «Название/показатель — Результат — [Предыдущий результат] — Референс», единицы рядом со значением, маркеры ▲/▼",
    "fallback": False,
}


def detect(text: str) -> bool:
    """Helix markers plus the new table header: «Название/показатель Результат …» without the «Ед. изм.» column."""
    if not ("Перейти в Личный кабинет" in text or "Заказ №" in text or "Зарегистрирован:" in text):
        return False
    for ln in text.splitlines():
        s = " ".join(ln.split())
        if s.startswith("Название/показатель") and "Результат" in s and "Ед. изм." not in s:
            return True
    return False


def parse_text(text: str) -> dict:
    lines = _lines(text)
    full_text = "\n".join(lines)

    doc_date = None
    m = re.search(r"Зарегистрирован:\s*(\d{2}\.\d{2}\.\d{4})", full_text)
    if m:
        try:
            doc_date = datetime.strptime(m.group(1), "%d.%m.%Y").date().isoformat()
        except Exception:
            doc_date = None

    observations: list[dict] = []

    current_section: str | None = None
    in_table = False
    pending_name: str | None = None

    for i, ln in enumerate(lines):
        if _is_noise(ln):
            continue

        low = ln.lower().strip()

        # start of a table block (many small tables back-to-back, one per analyte)
        if low.startswith("название/показатель"):
            in_table = True
            pending_name = None
            continue

        if not in_table:
            # section title before the first table; it may contain digits («Тироксин (Т4) свободный»)
            if low.startswith("метод") or low.startswith("комментарий") or _PREV_DATE.match(low) or _REF_LINE.match(ln):
                continue
            if len(ln) > 2 and low not in _GENERIC_LABELS:
                current_section = ln
            continue

        # end of table on footer
        if ln.startswith("*") or low.startswith("отчет создан"):
            in_table = False
            pending_name = None
            continue

        # skip method/equipment and comment lines inside the table
        if low.startswith("метод") or low.startswith("комментарий"):
            continue
        if "cobas" in low or "roche diagnostics" in low or "beckman" in low or "mindray" in low:
            continue
        # the previous-result date and the reference under the row are consumed by the row itself
        if _PREV_DATE.match(low) or _REF_LINE.match(ln):
            continue

        parts = ln.split()
        if not parts:
            continue

        # find the first value token (▲/▼ and <,> allowed)
        vidx = None
        for j, tok in enumerate(parts):
            if _VALUE.match(tok):
                vidx = j
                break

        # A section title can end in a separate number, e.g. «Интерлейкин 6».
        numbered_title = (
            len(parts) > 1 and vidx == len(parts) - 1
            and re.fullmatch(r"[0-9]+", parts[-1]) is not None and ln[0].isalpha()
        )
        if vidx is None or numbered_title:
            # not a row: a new analyte title (digits allowed, «Тироксин (Т4) свободный») or a wrapped name
            if len(ln) > 2 and low not in _GENERIC_LABELS:
                current_section = ln
            else:
                pending_name = ln
            continue

        if vidx + 1 >= len(parts) or not _looks_unit(parts[vidx + 1]):
            continue
        unit = parts[vidx + 1]

        # name candidates; a marker printed as its own token belongs to the value, not the name
        name_end = vidx
        if vidx > 0 and parts[vidx - 1] in ("▲", "▼", "↑", "↓"):
            name_end = vidx - 1
        name = " ".join(parts[:name_end]).strip() if name_end > 0 else (pending_name or "").strip()
        pending_name = None

        # if the row name is a generic label, use the section title
        gen = name.lower().strip()
        if gen in _GENERIC_LABELS:
            if current_section:
                name = current_section
            else:
                continue

        # special joiners
        if current_section:
            cs_low = current_section.lower()
            if ("hba1c" in cs_low or "гликирован" in cs_low) and gen.startswith("доля"):
                name = "Гликированный гемоглобин (HbA1c)"
            if ("ссгп" in cs_low or "среднесуточный уровень глюкозы" in cs_low) and ("плазмы" in gen or "ссгп" in gen):
                name = "Среднесуточная глюкоза (eAG)"

        # the ▲/▼ marker is dropped: the deviation is computed from the reference after commit
        val_tok = parts[vidx].lstrip(_MARKER)
        cmp = val_tok.startswith("<") or val_tok.startswith(">")
        val_text = val_tok.replace(",", ".")
        val_num = _to_float(val_tok[1:] if cmp else val_tok)

        # a second value+unit pair on the same line is the previous result, not the current one
        after = vidx + 2
        if after + 1 < len(parts) and _VALUE.match(parts[after]) and _looks_unit(parts[after + 1]):
            after += 2
        tail = " ".join(parts[after:]) if after < len(parts) else ""
        ref_text = _extract_ref_from_text(tail)
        if not ref_text:
            ref_text = _ref_on_following_lines(lines, i)

        ref_low, ref_high = _parse_ref(ref_text)

        observations.append(
            {
                "test_name": name,
                "result_text": val_text,
                "result_num": val_num,
                "units": unit,
                "ref_text": ref_text,
                "ref_low": ref_low,
                "ref_high": ref_high,
                "deviation_text": None,
                "criticality_text": None,
            }
        )

    return {
        "lab_name": "Хеликс",
        "doc_date": doc_date,
        "observations": observations,
    }

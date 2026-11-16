from __future__ import annotations

import re
from datetime import datetime


_NUM = re.compile(r"^[-+]?\d+[\.,]?\d*$")
# units typical in Helix outputs
_UNIT = re.compile(
    r"(ммоль/л|мкмоль/л|г/л|мг/л|мкг/л|нг/мл|пг/мл|ед/л|Ед/л|сек|%|\*10\^\d+/л|\*10\^\d+\/л|fL|пг|мм/ч|мл/мин/1,73м\^2)",
    re.I,
)


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


def _is_noise(line: str) -> bool:
    low = line.lower().strip()
    # headers / person
    if _PERSON_RE.match(line.strip()):
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
    if low.startswith("регистрация") or low.startswith("валидация"):
        return True
    if low.startswith("подтверждение"):
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
    "id": "helix_pdf_v1",
    "name": "Хеликс",
    "country": "RU",
    "description": "Бланки из личного кабинета «Хеликс»: много небольших таблиц «Название/показатель — Результат — Ед. — Референс» подряд",
    "fallback": False,
}


def detect(text: str) -> bool:
    return "Перейти в Личный кабинет" in text or "Заказ №" in text or "Зарегистрирован:" in text


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

        # section title (analyte / panel name)
        if not in_table:
            if not low.startswith("метод") and not low.startswith("метод и оборудование") and not low.startswith("название/показатель"):
                if not re.search(r"\d", ln) and len(ln) > 2 and not low.startswith("комментарий"):
                    current_section = ln

        # If we are inside a table and meet a new analyte title line (Helix has many small tables back-to-back),
        # update current_section. Avoid generic row labels.
        if in_table:
            if not low.startswith("метод") and not low.startswith("метод и оборудование") and not low.startswith("название/показатель") and not low.startswith("комментарий"):
                if not re.search(r"\d", ln) and len(ln) > 2:
                    if low not in _GENERIC_LABELS:
                        current_section = ln
                        continue

        # start of table block
        if low.startswith("название/показатель"):
            in_table = True
            pending_name = None
            continue

        if not in_table:
            continue

        # end of table on footer
        if ln.startswith("*") or low.startswith("отчет создан"):
            in_table = False
            pending_name = None
            continue

        # skip method/equipment lines inside table
        if low.startswith("метод") or low.startswith("метод и оборудование"):
            continue
        if "cobas" in low or "roche diagnostics" in low or "beckman" in low or "mindray" in low:
            continue
        if low.startswith("комментарий"):
            continue

        parts = ln.split()
        if not parts:
            continue

        # find first numeric-ish token
        vidx = None
        for j, tok in enumerate(parts):
            if tok.startswith("<") or tok.startswith(">") or _NUM.match(tok):
                vidx = j
                break
        if vidx is None:
            pending_name = ln
            continue

        # unit must exist and look like a unit
        unit = None
        if vidx + 1 < len(parts) and _UNIT.search(parts[vidx + 1]):
            unit = parts[vidx + 1]
        elif vidx + 1 < len(parts) and ("/" in parts[vidx + 1] or "^" in parts[vidx + 1] or "%" in parts[vidx + 1]):
            unit = parts[vidx + 1]
        else:
            # not a real measurement row
            continue

        # name candidates
        name = " ".join(parts[:vidx]).strip() if vidx > 0 else (pending_name or "").strip()
        pending_name = None

        # If row name is generic label, use section title
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

        val_tok = parts[vidx]
        val_text = val_tok.replace(",", ".")
        val_num = _to_float(val_tok[1:] if (val_tok.startswith("<") or val_tok.startswith(">")) else val_tok)

        tail = " ".join(parts[vidx + 2 :]) if vidx + 2 < len(parts) else ""
        ref_text = _extract_ref_from_text(tail)
        # lookahead for ref on next line (e.g. ALT previous result line)
        if not ref_text and i + 1 < len(lines):
            ref_text = _extract_ref_from_text(lines[i + 1])

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

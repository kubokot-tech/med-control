"""Golden tests on invented text layers: no real reports, no PDF files (parsers take the text pypdf extracts).

The fixtures in tests/fixtures are shared with the JavaScript port (gateway/test/labParsers.test.js); their
.expected.json files come from tools/golden.py.
"""
import json
import pathlib

from tools.golden import expected_for, pypdf_text
from app.connectors import registry
from app.connectors import dnkom_pdf_v1, hadassah_pdf_v1, helix_pdf_v1, mknc_pdf_v1

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
HELIX = (FIXTURES / "helix_basic.txt").read_text(encoding="utf-8")
MKNC = (FIXTURES / "mknc_basic.txt").read_text(encoding="utf-8")
UNKNOWN = (FIXTURES / "unknown.txt").read_text(encoding="utf-8")
HADASSAH = (FIXTURES / "hadassah_blood.txt").read_text(encoding="utf-8")
HADASSAH_COAG = (FIXTURES / "hadassah_coag.txt").read_text(encoding="utf-8")
HADASSAH_URINE = (FIXTURES / "hadassah_urine.txt").read_text(encoding="utf-8")


def obs(doc, name):
    return next(o for o in doc["observations"] if o["test_name"] == name)


DNKOM_BLOOD = (FIXTURES / "dnkom_blood.txt").read_text(encoding="utf-8")
DNKOM_BIOCHEM = (FIXTURES / "dnkom_biochem.txt").read_text(encoding="utf-8")
DNKOM_HORMONES = (FIXTURES / "dnkom_hormones.txt").read_text(encoding="utf-8")


def test_dnkom_detect_and_table():
    assert dnkom_pdf_v1.detect(DNKOM_BLOOD)
    assert not any(dnkom_pdf_v1.detect(t) for t in (HELIX, MKNC, UNKNOWN, HADASSAH))
    doc = dnkom_pdf_v1.parse_text(DNKOM_BLOOD)
    assert doc["doc_date"] == "2026-02-01"
    rbc = obs(doc, "Эритроциты (RBC)")
    assert (rbc["ref_high"], rbc["units"]) == (5.1, "10^12/л"), "the power of ten is not part of the reference"
    assert obs(doc, "Тромбоциты (PLT)")["ref_high"] == 401.5
    assert obs(doc, "Нейтрофилы, абс.")["units"] == "10^9/л"
    assert obs(doc, "Нейтрофилы, %")["result_num"] == 57.6
    assert obs(doc, "Нормобласты, абс.")["ref_high"] == 0.02
    assert obs(doc, "Нормобласты, %")["ref_high"] == 0.4
    assert obs(doc, "Лимфоциты, %")["result_num"] == 33.2, "the table goes on after the page break"


def test_dnkom_comments_and_wrapped_units():
    doc = dnkom_pdf_v1.parse_text(DNKOM_BIOCHEM)
    assert len(doc["observations"]) == 7, "numbers in the comments are not rows"
    assert obs(doc, "Холестерин-ЛПВП")["ref_low"] == 1.0
    assert obs(doc, "Аланинаминотрансфераза (АЛТ)")["ref_high"] == 40.0
    assert obs(doc, "Гликированный гемоглобин (HbA1%)")["result_num"] == 5.2
    crp = obs(doc, "С-реактивный белок, высокочувствительный")
    assert (crp["result_text"], crp["result_num"]) == ("< 0,30", None)
    doc = dnkom_pdf_v1.parse_text(DNKOM_HORMONES)
    assert len(doc["observations"]) == 4
    assert obs(doc, "2-OHE1+2-OHE2")["units"] == "нмоль/ммоль креатинина"
    assert obs(doc, "2-OMeE1/2-ОНЕ1")["units"] is None


def test_registry_ids_unique_and_meta_complete():
    ids = [p.META["id"] for p in registry.PARSERS]
    assert len(ids) == len(set(ids))
    for p in registry.PARSERS:
        assert {"id", "name", "country", "description", "fallback"} <= set(p.META)
        assert callable(p.detect) and callable(p.parse_text)
    assert [x["id"] for x in registry.public_list()] == ids


def test_detection_and_candidates():
    assert helix_pdf_v1.detect(HELIX) and not mknc_pdf_v1.detect(HELIX)
    assert mknc_pdf_v1.detect(MKNC) and not helix_pdf_v1.detect(MKNC)
    assert registry.candidates(HELIX)[0] is helix_pdf_v1
    assert registry.candidates(MKNC) == [mknc_pdf_v1]
    assert registry.candidates(UNKNOWN) == [mknc_pdf_v1], "unknown layouts only get the fallback parser"
    assert hadassah_pdf_v1.detect(HADASSAH) and not helix_pdf_v1.detect(HADASSAH) and not mknc_pdf_v1.detect(HADASSAH)
    assert not any(hadassah_pdf_v1.detect(t) for t in (HELIX, MKNC, UNKNOWN))
    assert registry.candidates(HADASSAH) == [hadassah_pdf_v1, mknc_pdf_v1]
    assert hadassah_pdf_v1.detect(HADASSAH_COAG) and hadassah_pdf_v1.detect(HADASSAH_URINE), "both layouts"


def test_helix_rows_dates_refs_and_section_names():
    doc = helix_pdf_v1.parse_text(HELIX)
    assert doc["lab_name"] == "Хеликс"
    assert doc["doc_date"] == "2026-02-03"
    hgb = obs(doc, "Гемоглобин")
    assert (hgb["result_num"], hgb["units"], hgb["ref_low"], hgb["ref_high"]) == (132, "г/л", 117, 160)
    assert obs(doc, "Лейкоциты")["result_num"] == 6.2
    alt = obs(doc, "Аланинаминотрансфераза (АЛТ)")  # generic «Активность» row takes the section title
    assert (alt["result_num"], alt["ref_high"]) == (96, 40)
    assert all("Иванова" not in o["test_name"] for o in doc["observations"]), "the patient line is noise"


def test_mknc_rows_and_meta():
    doc = mknc_pdf_v1.parse_text(MKNC)
    assert doc["doc_date"] == "2026-03-05"
    assert doc["lab_name"] == "Демо-центр лабораторной диагностики"
    hgb = obs(doc, "Гемоглобин")
    assert (hgb["result_num"], hgb["units"], hgb["ref_low"], hgb["ref_high"]) == (132, "г/л", 120, 160)
    assert obs(doc, "Аланинаминотрансфераза")["result_num"] == 96


def test_hadassah_wrapped_names_glued_units_and_formula():
    doc = hadassah_pdf_v1.parse_text(HADASSAH)
    assert (doc["lab_name"], doc["doc_date"]) == ("Хадасса", "2026-03-05")
    assert len(doc["observations"]) == 45
    wbc = obs(doc, "Лейкоциты (WBC)")
    assert (wbc["result_num"], wbc["units"], wbc["ref_low"], wbc["ref_high"]) == (6.12, "10^9/л", 3.7, 9.5), "«*109 кл/л» is 10^9/л"
    assert obs(doc, "Эритроциты (RBC)")["units"] == "10^12/л"
    assert (obs(doc, "Гемоглобин (HGB)")["units"], obs(doc, "Гемоглобин (HGB)")["ref_text"]) == ("г/л", "130 - 168")
    mch = obs(doc, "Среднее содержание гемоглобина в эритроците (MCH)")  # name over three lines, numbers on the fourth
    assert (mch["result_num"], mch["units"]) == (29.7, "пг")
    assert obs(doc, "Ретикулоциты, абсолютное количество (RET#)")["result_num"] == 52.2, "a name continued after a page break"
    eo = obs(doc, "Эозинофилы, абс.")
    assert (eo["result_num"], eo["ref_high"], eo["units"]) == (0.51, 0.4, "10^9/л"), "the ↑ flag is dropped"
    assert (obs(doc, "Эозинофилы, %")["result_num"], obs(doc, "Эозинофилы, %")["units"]) == (8.3, "%")
    nrbc = obs(doc, "Нормобласты")
    assert (nrbc["ref_text"], nrbc["ref_low"], nrbc["ref_high"], nrbc["units"]) == ("0", None, None, "10^9/л")
    assert obs(doc, "Процент больших тромбоцитов (P-LCR)")["units"] == "%"
    assert obs(doc, "Скорость оседания эритроцитов (СОЭ)")["units"] == "мм/час"
    names = " ".join(o["test_name"] for o in doc["observations"])
    for noise in ("ИВАНОВА", "Петров", "Сидорова", "Отделение", "WDF", "PLT-F", "Филиал", "интервал"):
        assert noise not in names


def test_hadassah_coagulation_and_qualitative_table():
    doc = hadassah_pdf_v1.parse_text(HADASSAH_COAG)
    assert (doc["doc_date"], len(doc["observations"])) == ("2026-03-06", 10)
    aptt = obs(doc, "Активированное частичное тромбопластиновое время (АЧТВ)")
    assert (aptt["result_num"], aptt["units"], aptt["ref_high"]) == (29.6, "сек", 28.0)
    assert obs(doc, "Д-димер")["units"] == "нг/мл", "the second table on the page"
    # «Наименование Результат» without a reference column: the result is the qualitative word at the end of the line
    assert obs(doc, "Фенотип по антигенам резус")["result_text"] == "CcDee"
    kell = obs(doc, "Kell антиген (К)")
    assert (kell["result_text"], kell["result_num"], kell["ref_text"]) == ("Отрицательный", None, None)
    assert obs(doc, "Аллоиммунные антиэритроцитарные антитела (непрямая проба Кумбса)")["result_text"] == "не обнаружено"


def test_hadassah_list_layout_urine():
    doc = hadassah_pdf_v1.parse_text(HADASSAH_URINE)
    assert (doc["lab_name"], doc["doc_date"], len(doc["observations"])) == ("Хадасса", "2026-03-06", 20)
    assert all(o["test_name"].endswith(" (моча)") for o in doc["observations"]), "rows of the urinalysis section are marked"
    color = obs(doc, "Цвет (моча)")
    assert (color["result_text"], color["ref_text"]) == ("желтый", "соломенно-желтый, желтый, светло-желтый"), "reference over three lines"
    assert obs(doc, "Мутность (моча)")["result_text"] == "слабо мутная"
    sg = obs(doc, "Относительная плотность (моча)")
    assert (sg["result_num"], sg["units"], sg["ref_low"], sg["ref_high"]) == (1.018, None, 1.01, 1.025)
    prot = obs(doc, "Белок (моча)")
    assert (prot["result_num"], prot["units"], prot["ref_text"]) == (0.15, "г/л", "Не обнаружено")
    assert (obs(doc, "Глюкоза (моча)")["result_text"], obs(doc, "Глюкоза (моча)")["units"]) == ("Не обнаружено", "ммоль/л")
    uro = obs(doc, "Уробилиноген (моча)")
    assert (uro["result_text"], uro["result_num"], uro["ref_high"]) == ("< 25", None, 25.0)
    assert obs(doc, "Реакция на кровь (мг/дл) (моча)")["units"] == "мг/дл", "a unit in the name is not the unit column"
    assert obs(doc, "Нитриты (моча)")["units"] is None
    leu = obs(doc, "Лейкоциты (моча)")
    assert (leu["result_num"], leu["units"], leu["ref_high"]) == (18.2, "кл/мкл", 11.7)
    bac = obs(doc, "Бактерии (моча)")
    assert (bac["result_num"], bac["units"], bac["ref_high"]) == (12.6, "10^3/мл", 10.0), "unit and reference on the next lines"
    slime = obs(doc, "Слизь (моча)")
    assert (slime["result_num"], slime["units"], slime["ref_text"]) == (0.2, None, "Не нормировано")
    names = " ".join(o["test_name"] for o in doc["observations"])
    for noise in ("Иванова", "Петров", "Сидорова", "Анализ мочи", "Подпись"):
        assert noise not in names


def test_fallback_parser_finds_nothing_in_a_foreign_layout():
    assert mknc_pdf_v1.parse_text(UNKNOWN)["observations"] == []


def test_fixtures_match_their_golden_json():
    """Changing a parser changes these files: run tools/golden.py, review the diff, keep the JS port in step."""
    txts = sorted(FIXTURES.glob("*.txt"))
    assert txts
    for txt in txts:
        expected = json.loads(txt.with_suffix(".expected.json").read_text(encoding="utf-8"))
        assert json.loads(json.dumps(expected_for(txt.read_text(encoding="utf-8")), ensure_ascii=False)) == expected, txt.name


def test_pypdf_text_layers_of_the_layout_pdfs():
    """Generated PDFs (gateway/test/makeLayoutPdfs.js); the JS text layer (gateway/src/lib/pdfText.js) is checked against the same files."""
    pdfs = sorted((FIXTURES / "pdf").glob("*.pdf"))
    assert pdfs
    for pdf in pdfs:
        assert pypdf_text(pdf.read_bytes()) == pdf.with_suffix(".pypdf.txt").read_text(encoding="utf-8"), pdf.name

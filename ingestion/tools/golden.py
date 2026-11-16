"""Write the expected output of every fixture from the Python side, the reference for the JavaScript port:
- tests/fixtures/*.txt -> .expected.json: candidates and every parser's parse of that text layer;
- tests/fixtures/pdf/*.pdf -> .pypdf.txt: the text layer pypdf gives (what ingestion's _pdf_text() passes to parsers).

The Python parsers are the reference: the JavaScript port in gateway/src/lib/labParsers must give the same JSON
(gateway/test/labParsers.test.js), so after changing a parser run this, review the diff and commit both.

    cd ingestion && python tools/golden.py
"""
import io
import json
import pathlib
import sys

from pypdf import PdfReader

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from app.connectors import registry  # noqa: E402

FIXTURES = pathlib.Path(__file__).resolve().parents[1] / "tests" / "fixtures"


def expected_for(text: str) -> dict:
    """What a text layer gives: the candidates in order and, for each, its parse (or the error type)."""
    out = {"candidates": [p.META["id"] for p in registry.candidates(text)], "parses": {}}
    for p in registry.PARSERS:
        try:
            out["parses"][p.META["id"]] = p.parse_text(text)
        except Exception as e:  # noqa: BLE001
            out["parses"][p.META["id"]] = {"error": type(e).__name__}
    return out


def pypdf_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((p.extract_text() or "") for p in reader.pages)


def main() -> None:
    for txt in sorted(FIXTURES.glob("*.txt")):
        exp = expected_for(txt.read_text(encoding="utf-8"))
        txt.with_suffix(".expected.json").write_text(json.dumps(exp, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(txt.name, exp["candidates"], {k: len(v.get("observations", [])) for k, v in exp["parses"].items()})
    for pdf in sorted((FIXTURES / "pdf").glob("*.pdf")):
        pdf.with_suffix(".pypdf.txt").write_text(pypdf_text(pdf.read_bytes()), encoding="utf-8")
        print(pdf.name, "text layer written")


if __name__ == "__main__":
    main()

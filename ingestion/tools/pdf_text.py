"""Print the text layer of a PDF exactly as the parsers see it (pypdf), to write a parser or a test fixture.

    docker compose exec -T ingestion python tools/pdf_text.py < report.pdf > report.txt
    python tools/pdf_text.py report.pdf

Before sharing or committing the output, replace the name, birth date, order numbers, address and doctor with invented
ones (see docs/LAB-PARSERS.md, «Обезличивание»).
"""
import io
import sys

from pypdf import PdfReader


def main() -> None:
    data = open(sys.argv[1], "rb").read() if len(sys.argv) > 1 else sys.stdin.buffer.read()
    reader = PdfReader(io.BytesIO(data))
    sys.stdout.write("\n".join((p.extract_text() or "") for p in reader.pages))


if __name__ == "__main__":
    main()

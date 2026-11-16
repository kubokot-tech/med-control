from __future__ import annotations

import hashlib
import tempfile
from fastapi import FastAPI, UploadFile, File, HTTPException

from .types import IngestLabsResponse, ExtractedObservation
from .connectors import registry

app = FastAPI(title="MedControl Ingestion", version="0.2.0")


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/parsers")
def parsers():
    """Laboratories recognised without AI, for the settings page and docs."""
    return {"parsers": registry.public_list()}


def _pdf_text(path: str) -> str:
    from pypdf import PdfReader

    rr = PdfReader(path)
    return "\n".join((p.extract_text() or "") for p in rr.pages)


@app.post("/ingest/labs/pdf", response_model=IngestLabsResponse)
async def ingest_labs_pdf(file: UploadFile = File(...), source: str | None = None):
    src = source or "auto"
    if src != "auto" and registry.by_id(src) is None:
        raise HTTPException(status_code=400, detail=f"unsupported source: {src}")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")
    sha = hashlib.sha256(data).hexdigest()
    with tempfile.NamedTemporaryFile(delete=True, suffix=".pdf") as tmp:
        tmp.write(data)
        tmp.flush()
        try:
            text = _pdf_text(tmp.name)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=422, detail=f"cannot read pdf: {e}")

    tried = [registry.by_id(src)] if src != "auto" else registry.candidates(text)
    doc, used = None, None
    for parser in tried:
        try:
            out = parser.parse_text(text)
        except Exception:  # noqa: BLE001  a parser that chokes on a foreign layout simply does not match
            continue
        if out.get("observations"):
            doc, used = out, parser.META["id"]
            break
    if doc is None:
        raise HTTPException(status_code=422, detail="no observations parsed")

    obs_out = [
        ExtractedObservation(
            test_name_raw=o.get("test_name") or "",
            result_text=o.get("result_text"),
            result_num=o.get("result_num"),
            unit_raw=o.get("units"),
            ref_text_raw=o.get("ref_text"),
            ref_low=o.get("ref_low"),
            ref_high=o.get("ref_high"),
        )
        for o in doc["observations"]
    ]
    return IngestLabsResponse(source=used, lab_name=doc.get("lab_name"), doc_date=doc.get("doc_date"), sha256=sha, observations=obs_out)


@app.post("/extract/pdf")
async def extract_pdf(file: UploadFile = File(...)):
    """Plain text of a PDF, page by page (pypdf). Scanned PDFs return little or no text: the caller falls back to a model."""
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")
    with tempfile.NamedTemporaryFile(delete=True, suffix=".pdf") as tmp:
        tmp.write(data)
        tmp.flush()
        try:
            from pypdf import PdfReader

            rr = PdfReader(tmp.name)
            pages = [(p.extract_text() or "").strip() for p in rr.pages]
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=422, detail=f"cannot read pdf: {e}")
    text = "\n\n".join(f"<!-- страница {i + 1} -->\n{t}" for i, t in enumerate(pages) if t)
    return {"pages": len(pages), "chars": sum(len(t) for t in pages), "text": text}

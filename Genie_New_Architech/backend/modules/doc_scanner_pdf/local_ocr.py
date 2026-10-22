from __future__ import annotations

import io

from PIL import Image


def extract_local_ocr(image_bytes: bytes) -> str:
    try:
        import pytesseract
    except ImportError as error:
        raise RuntimeError("Install a local Tesseract binary and pytesseract for OCR.") from error
    with Image.open(io.BytesIO(image_bytes)) as image:
        return pytesseract.image_to_string(image)

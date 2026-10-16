from __future__ import annotations

import io

from PIL import Image


def export_a4_pdf(image_bytes: bytes) -> bytes:
    with Image.open(io.BytesIO(image_bytes)) as source:
        image = source.convert("RGB")
        page_width, page_height = 2480, 3508
        image.thumbnail((page_width, page_height), Image.Resampling.LANCZOS)
        page = Image.new("RGB", (page_width, page_height), "white")
        page.paste(image, ((page_width - image.width) // 2, (page_height - image.height) // 2))
        output = io.BytesIO()
        page.save(output, format="PDF", resolution=300)
        return output.getvalue()

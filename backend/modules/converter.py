import logging
from pathlib import Path
from typing import Generator

from PIL import Image

from config import settings

logger = logging.getLogger(__name__)


def pdf_to_images(pdf_path: Path, store_name: str) -> Generator[tuple[int, Image.Image], None, None]:
    """Convert PDF pages to PIL Images. Yields (page_number, image) tuples.

    Requires Poppler on PATH. On Windows:
      https://github.com/oschwartz10612/poppler-windows/releases
    """
    try:
        import pdf2image
        import pdf2image.exceptions
    except ImportError:
        logger.error("pdf2image not installed. Run: pip install pdf2image")
        return

    try:
        pages = pdf2image.convert_from_path(
            pdf_path,
            dpi=settings.pdf_dpi,
            fmt="jpeg",
            first_page=1,
            last_page=settings.max_pages_per_pdf,
            thread_count=2,
        )
    except pdf2image.exceptions.PDFInfoNotInstalledError:
        logger.error(
            f"[{store_name}] Poppler not found on PATH.\n"
            "  Windows: download from https://github.com/oschwartz10612/poppler-windows/releases\n"
            "  Extract and add the 'Library/bin' subfolder to your system PATH."
        )
        return
    except Exception as e:
        logger.error(f"[{store_name}] PDF conversion failed: {e}")
        return

    logger.info(f"[{store_name}] Converted {len(pages)} pages @ {settings.pdf_dpi} DPI")

    for page_num, image in enumerate(pages, start=1):
        yield page_num, image

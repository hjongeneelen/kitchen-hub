import base64
import io
import logging
from typing import Optional

from openai import OpenAI
from PIL import Image
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from config import settings

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = (
    "You are a JSON-only data extraction assistant for Dutch supermarket promotional flyers. "
    "You NEVER write explanatory text, commentary, or markdown formatting. "
    "You ONLY output a raw JSON array — nothing before it, nothing after it."
)

_USER_PROMPT = """Analyze this supermarket folder page from {store}.
Extract ALL product promotions and deals visible in the image.

Return ONLY a raw JSON array in this exact format — no markdown, no explanation:
[
  {{
    "winkel": "{store}",
    "productnaam": "exact product name as printed",
    "korting_tekst": "promotion text e.g. '2e halve prijs' or '50% korting'",
    "actieprijs": 2.49,
    "inhoud_waarde": 400,
    "inhoud_unit": "gram"
  }}
]

Field rules:
- "winkel" must always be "{store}"
- "actieprijs" → sale price as decimal (use . not ,); null if unknown
- "inhoud_waarde" → integer weight/volume (e.g. 400 for 400g or 400ml); null if unknown
- "inhoud_unit" → one of: gram, ml, liter, kg, stuks, rol; null if unknown
- "korting_tekst" → null if no promotion text

If this page shows no product deals, return exactly: []"""


def _encode_image(image: Image.Image, max_width: int = 1920, quality: int = 85) -> str:
    """Resize if needed, encode to base64 JPEG."""
    if image.width > max_width:
        ratio = max_width / image.width
        image = image.resize(
            (max_width, int(image.height * ratio)), Image.LANCZOS
        )
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=quality)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def get_llm_client() -> OpenAI:
    return OpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key)


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=4, max=30),
    retry=retry_if_exception_type(Exception),
    reraise=True,
)
def _call_with_retry(client: OpenAI, image_b64: str, store_name: str) -> str:
    response = client.chat.completions.create(
        model=settings.llm_model,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{image_b64}",
                            "detail": "high",
                        },
                    },
                    {
                        "type": "text",
                        "text": _USER_PROMPT.format(store=store_name),
                    },
                ],
            },
        ],
        max_tokens=4096,
        temperature=0.1,
        timeout=settings.llm_timeout,
    )
    return response.choices[0].message.content or ""


def extract_deals_from_image(
    image: Image.Image,
    store_name: str,
    client: Optional[OpenAI] = None,
) -> str:
    """Send one page image to the vision LLM and return raw text response."""
    if client is None:
        client = get_llm_client()

    image_b64 = _encode_image(image)
    raw = _call_with_retry(client, image_b64, store_name)
    logger.debug(f"[{store_name}] Raw LLM response (first 300 chars): {raw[:300]}")
    return raw

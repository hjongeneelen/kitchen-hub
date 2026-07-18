from openai import OpenAI

from config import settings


def get_llm_client() -> OpenAI:
    return OpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key)

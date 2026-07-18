from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── JSON export ───────────────────────────────────────────────────────────
    data_dir: Path = Field(default=Path("../public/data"))

    # ── Local LLM (categorization + ingredient matching only — no vision) ────
    llm_base_url: str = Field(default="http://localhost:11434/v1")
    llm_api_key: str = Field(default="ollama")
    llm_model: str = Field(default="qwen3.5:9b")
    llm_timeout: int = Field(default=120)
    llm_max_retries: int = Field(default=3)


settings = Settings()

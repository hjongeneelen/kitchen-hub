from pathlib import Path
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── JSON export ───────────────────────────────────────────────────────────
    data_dir: Path = Field(default=Path("../public/data"))

    # ── Local Vision LLM ─────────────────────────────────────────────────────
    llm_base_url: str = Field(default="http://localhost:11434/v1")
    llm_api_key: str = Field(default="ollama")
    llm_model: str = Field(default="llava:13b")
    llm_timeout: int = Field(default=120)
    llm_max_retries: int = Field(default=3)

    # ── Processing ───────────────────────────────────────────────────────────
    pdf_dpi: int = Field(default=200)
    max_pages_per_pdf: int = Field(default=20)
    cache_dir: Path = Field(default=Path("cache"))

    # ── Tier A: Predictable Publitas slugs (rarely need manual override) ─────
    hoogvliet_pdf_url: Optional[str] = Field(default=None)   # week-number URL auto-constructed
    boni_pdf_url: Optional[str] = Field(default=None)
    poiesz_pdf_url: Optional[str] = Field(default=None)
    da_drogist_pdf_url: Optional[str] = Field(default=None)

    # ── Tier B: Publitas API discovery (set if auto-discovery fails) ─────────
    coop_pdf_url: Optional[str] = Field(default=None)
    kruidvat_pdf_url: Optional[str] = Field(default=None)
    etos_pdf_url: Optional[str] = Field(default=None)
    nettorama_pdf_url: Optional[str] = Field(default=None)
    dekamarkt_pdf_url: Optional[str] = Field(default=None)
    blokker_pdf_url: Optional[str] = Field(default=None)
    gamma_pdf_url: Optional[str] = Field(default=None)
    praxis_pdf_url: Optional[str] = Field(default=None)

    # Albert Heijn, Lidl, Dirk, Jumbo, Plus, and Aldi use structured connectors
    # (API or headless-browser DOM read) — no PDF URL setting needed for any of them.


settings = Settings()

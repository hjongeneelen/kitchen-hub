"""
Kruidvat — delegates to PublitasScraper (group ID: 189).
Kept as a named module so it can be imported by name in main.py,
and to allow future Kruidvat-specific overrides if needed.
"""
from scrapers.publitas import PublitasScraper


class KruidvatScraper(PublitasScraper):
    def __init__(self) -> None:
        super().__init__(store_name="Kruidvat", group="189")

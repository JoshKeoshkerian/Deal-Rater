"""Helpful links out to KBB and Consumer Reports (build step 12).

Pure URL templating from year/make/model -- no network call, no scraping, no
API key. See `builder.py` for the slugging and fallback rules.
"""

from .builder import HelpfulLink, build_helpful_links

__all__ = ["HelpfulLink", "build_helpful_links"]

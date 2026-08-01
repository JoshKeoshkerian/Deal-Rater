"""Tunable constants for helpful links (build step 12, additive to spec 6/7).

UNCALIBRATED like every other params module here, but there is nothing to
calibrate against: there is no score, confidence level or comp count involved.
This module only decides whether a (year, make, model) triple is clean enough
to drop into a URL template.
"""

from __future__ import annotations

#: KBB's model-year page. Confirmed live, e.g. https://www.kbb.com/mazda/cx-5/2020/
#: -- lowercase, hyphenated make and model slugs, no trailing query string.
KBB_MODEL_URL = "https://www.kbb.com/{make}/{model}/{year}/"

#: KBB's general values landing page, used whenever make/model will not
#: reliably slugify. Deliberately not a search-results URL with a query string
#: built from unvalidated text -- that has the same "guessing a broken URL"
#: problem this module exists to avoid, just moved into a query parameter.
KBB_FALLBACK_URL = "https://www.kbb.com/car-values/"

#: Consumer Reports' model overview page, e.g.
#: https://www.consumerreports.org/cars/mazda/cx-5/2020/overview/ -- confirmed
#: live. CR paywalls most of the substance behind this page (full road test,
#: reliability history, owner satisfaction detail), but the overview itself,
#: including the reliability verdict summary, is visible without a
#: subscription, so the link is a valid jumping-off point either way.
CONSUMER_REPORTS_MODEL_URL = "https://www.consumerreports.org/cars/{make}/{model}/{year}/overview/"

#: Consumer Reports' general car section, used on the same fallback trigger as
#: `KBB_FALLBACK_URL`.
CONSUMER_REPORTS_FALLBACK_URL = "https://www.consumerreports.org/cars/"

#: Most tokens a clean `model` value should have. Real multi-word models exist
#: ("Grand Cherokee", "Range Rover Sport") so this is deliberately loose rather
#: than 1 -- it exists to catch the specific failure this feature guards
#: against: a trim/engine/package string concatenated onto the model when
#: title parsing found nothing to split it from (see `builder.py`'s module
#: docstring). Four or more tokens is past what any real model name uses.
MAX_MODEL_TOKENS = 3

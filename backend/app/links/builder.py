"""Helpful links: KBB and Consumer Reports jumping-off points (additive to
spec 6/7, build step 12).

WHAT THIS IS AND ISN'T
-----------------------
Pure URL templating from (year, make, model[, trim]). No network call, no
scraping, no API key -- KBB and Consumer Reports are never fetched, only
linked to, so there is nothing here for either site's terms of service to
object to. Spec 8.2's minimization principle applies the same way it does to
everything else in this codebase: no seller data and no listing-specific data
(price, mileage, VIN, description) goes into a URL. Only the vehicle identity
does, and that identity is the whole reason the link is useful.

Deliberately independent of `pricing/` and `alternatives/`: this has no
minimum-comp requirement, no confidence level, and nothing to fall back
through when the comp set is thin, because it never reads the comp set at
all. It runs off `capture.target`'s year/make/model alone, which is why
`evaluation/__init__.py` computes it before pricing rather than after.

WHY MODEL NEEDS ITS OWN CLEANLINESS CHECK
-------------------------------------------
By the time a listing reaches evaluation, `model` has USUALLY already been
split cleanly from trim -- `extract/fields/vehicle.ts` prefers the TITLE
parse over Facebook's own `vehicle_model_display_name` for exactly this
reason (see that module's docstring: the raw field jams in the trim or
repeats the make on roughly half of captured listings -- "911 carrera",
"civic ex", "q5 2.0t premium plus", "MAZDA MAZDA3"). But the title parse can
fail outright (no title text, or a make the parser does not recognise), and
when it does, `model` falls back to that same raw, uncleaned field. This
module cannot assume the value it receives is clean, and the fixtures named
above are exactly what `MAX_MODEL_TOKENS` and `_looks_clean` guard against.

Two repairs, not just rejections:

  - A repeated make ("MAZDA MAZDA3") is STRIPPED, not treated as malformed --
    `normalize_key` (this codebase's own make/model comparison, reused rather
    than re-derived) already knows how to recognise it, and the repaired
    model still slugs into a real, working link.
  - An engine, body-style or drivetrain word found INSIDE the model string
    (via `vehicle_facts.decompose`, built for trim text but just as useful
    here) means a trim or package got concatenated onto the model with
    nothing to split it back off. That case falls back to the site's general
    landing page rather than guessing at a broken URL.

KNOWN GAP, LEFT OPEN ON PURPOSE: a two-word model where the second word is a
short, bare trim code -- "civic ex", "911 carrera" -- has none of the above
signals. `services/vehicle_facts.py` excludes exactly these short codes from
its own trim-phrase list for the same reason ("a two-letter code produces far
more false positives than genuine catches"), and nothing server-side has a
make/model catalog to check against instead. The asymmetry that makes this
tolerable here and not there: a wrong link in this section is a dead or
generic KBB/CR page the user can still search from, not a wrong comp
poisoning the price estimate. Closing this gap needs a real catalog, not a
sharper regex.

WHY TRIM NEVER ENTERS THE URL
-------------------------------
KBB and Consumer Reports model pages are year/make/model-scoped, not
trim-scoped -- spec-equivalent to this feature's own instruction not to chase
a dollar figure. `trim` is still accepted as an input because it changes the
NOTE text (telling the user the page covers the model in general, not their
specific trim) even though it never changes the URL.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..pricing.comps import normalize_key
from ..services.vehicle_facts import decompose
from . import params


@dataclass(frozen=True)
class HelpfulLink:
    label: str
    url: str
    #: Explains what the link is for and its limits. Identical whether the URL
    #: landed on a direct model page or a fallback search page -- spec (build
    #: step 12, item 6): a buyer is never shown a different treatment for one
    #: versus the other, so the payload does not carry a fallback flag either.
    note: str | None = None


_SLUG_DISALLOWED = re.compile(r"[^a-z0-9-]+")
_SLUG_MULTI_HYPHEN = re.compile(r"-{2,}")


def _slugify(value: str) -> str:
    """Lowercase, spaces and stray characters to hyphens, existing hyphens kept.

    "CX-5" -> "cx-5", "F-150" -> "f-150", "Model 3" -> "model-3" -- confirmed
    against KBB's and Consumer Reports' live URL patterns (see `params.py`),
    which both keep the hyphen a model already has rather than stripping it
    the way `pricing.comps.normalize_key`'s alnum-only comparison would.
    """
    text = value.strip().lower()
    text = _SLUG_DISALLOWED.sub("-", text)
    text = _SLUG_MULTI_HYPHEN.sub("-", text)
    return text.strip("-")


def _strip_repeated_make(make: str, model: str) -> str:
    """Undo "MAZDA MAZDA3": a model that restates the make is the make's own
    catalog string leaking in unparsed, not part of the model name.

    Checks the two-token prefix before the one-token prefix, the same order
    `parseVehicleTitle` uses client-side, so a two-word make written out in
    full ("Mercedes Benz C300") is recognised as a whole rather than leaving
    "Benz" behind as if it were the model.
    """
    tokens = model.split()
    make_key = normalize_key(make)
    if not make_key:
        return model
    for n in (2, 1):
        if len(tokens) > n and normalize_key("".join(tokens[:n])) == make_key:
            return " ".join(tokens[n:])
    return model


def _looks_clean(model: str) -> bool:
    """Whether `model` is a plausible model name rather than a model+trim
    string with nothing to split them.

    See the module docstring's "KNOWN GAP" for what this does not catch.
    """
    if len(model.split()) > params.MAX_MODEL_TOKENS:
        return False
    # `decompose` is built for trim strings, not model names, but a body
    # style, drivetrain or engine designator has no business appearing in a
    # model name either way -- its presence means a trim/package string got
    # concatenated on with nothing server-side to split it back off.
    facts = decompose(model)
    return facts.engine_text is None and facts.body_style is None and facts.drivetrain is None


def _model_page_slugs(
    year: int | None, make: str | None, model: str | None
) -> tuple[str, str] | None:
    """The (make, model) slug pair for a direct model-year page, or None when
    nothing here can be trusted enough to build one."""
    if year is None or not make or not model:
        return None

    cleaned_model = _strip_repeated_make(make, model)
    if not cleaned_model or not _looks_clean(cleaned_model):
        return None

    make_slug = _slugify(make)
    model_slug = _slugify(cleaned_model)
    # Both must retain at least one letter: a slug of bare digits or hyphens
    # ("Model 3"'s "3" alone, a stray punctuation run) is not a page either
    # site actually serves.
    if not (make_slug and model_slug):
        return None
    if not (any(c.isalpha() for c in make_slug) and any(c.isalpha() for c in model_slug)):
        return None
    return make_slug, model_slug


_KBB_NOTE = (
    "Independent pricing reference. KBB still needs your mileage, ZIP code "
    "and condition to produce a value -- this link only gets you to the "
    "right page, not a figure."
)
_KBB_NOTE_WITH_TRIM = (
    _KBB_NOTE + " Results are for the model overall, not specifically the {trim} trim."
)

_CR_NOTE = (
    "Reliability history and owner satisfaction for this model. Consumer "
    "Reports paywalls most of the detail, but the overview is visible "
    "without a subscription."
)
_CR_NOTE_WITH_TRIM = (
    _CR_NOTE + " Results are for the model overall, not specifically the {trim} trim."
)


def build_helpful_links(
    *,
    year: int | None,
    make: str | None,
    model: str | None,
    trim: str | None = None,
) -> tuple[HelpfulLink, ...]:
    """KBB and Consumer Reports links for this vehicle (build step 12).

    Always returns both links -- there is no minimum-comp or confidence gate,
    because nothing here depends on the comp set. Each independently falls
    back to its site's general landing page when year/make/model will not
    slug into a trustworthy direct link; the two sites are graded separately
    since a garbled model that fails one template does not necessarily fail
    the other's cleanliness bar (it always will here, since both use the same
    `_model_page_slugs` check, but keeping the check per-link is what lets one
    site's URL pattern change later without touching the other).
    """
    slugs = _model_page_slugs(year, make, model)

    kbb_note = _KBB_NOTE_WITH_TRIM.format(trim=trim) if trim else _KBB_NOTE
    cr_note = _CR_NOTE_WITH_TRIM.format(trim=trim) if trim else _CR_NOTE

    if slugs is not None:
        make_slug, model_slug = slugs
        kbb_url = params.KBB_MODEL_URL.format(make=make_slug, model=model_slug, year=year)
        cr_url = params.CONSUMER_REPORTS_MODEL_URL.format(
            make=make_slug, model=model_slug, year=year
        )
    else:
        kbb_url = params.KBB_FALLBACK_URL
        cr_url = params.CONSUMER_REPORTS_FALLBACK_URL

    return (
        HelpfulLink(label="Kelley Blue Book", url=kbb_url, note=kbb_note),
        HelpfulLink(label="Consumer Reports", url=cr_url, note=cr_note),
    )

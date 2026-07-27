"""NHTSA API access with database-backed caching (spec 4.2, 6.2, 10).

Three free, key-less endpoints:

    vPIC decode      vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/<vin>
    recalls          api.nhtsa.gov/recalls/recallsByVehicle?make&model&modelYear
    complaints       api.nhtsa.gov/complaints/complaintsByVehicle?...

CACHING IS NOT AN OPTIMISATION HERE, IT IS THE DESIGN (spec 10)
---------------------------------------------------------------
    VIN decodes    cached indefinitely -- "VIN-to-specification mapping never
                   changes"
    recalls        cached 30 days
    complaints     cached alongside recalls, same key, same window

Every function below reads the cache first and only reaches the network on a
miss. `offline=True` disables the network entirely, which is what the test suite
and any dry run use.

NETWORK FAILURE IS NOT AN ERROR HERE
------------------------------------
Spec 4.2: "Opportunistic, not required." A decode that fails leaves the
evaluation exactly as it was before step 6 existed, so every call returns None
rather than raising. An outage must not take the pricing model down with it.
"""

from __future__ import annotations

import json
import logging
import ssl
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import UTC, datetime, timedelta

import certifi
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import VehicleSafetyLookup, VinDecode
from .vin import normalize_vin

logger = logging.getLogger(__name__)

VPIC_DECODE_URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{vin}?format=json"
RECALLS_URL = "https://api.nhtsa.gov/recalls/recallsByVehicle"
COMPLAINTS_URL = "https://api.nhtsa.gov/complaints/complaintsByVehicle"

#: Spec 10: "recall lookups for 30 days".
SAFETY_CACHE_DAYS = 30

REQUEST_TIMEOUT_SECONDS = 20

_USER_AGENT = "deal-rater/0.1 (+contact via repository)"


def _ssl_context() -> ssl.SSLContext:
    """TLS context backed by certifi's CA bundle.

    Python installed from python.org does not read macOS's system keychain, so
    the default context fails every HTTPS request with CERTIFICATE_VERIFY_FAILED
    while curl on the same machine succeeds. Pinning certifi makes the behaviour
    identical across developer machines and containers.

    Verification stays ON. An unverified context would "fix" this too, and would
    silently accept any certificate for a government data source.
    """
    return ssl.create_default_context(cafile=certifi.where())


def _get_json(url: str) -> dict | None:
    """One GET, returning parsed JSON or None. Never raises."""
    request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urllib.request.urlopen(
            request, timeout=REQUEST_TIMEOUT_SECONDS, context=_ssl_context()
        ) as response:
            if response.status != 200:
                logger.warning("NHTSA returned HTTP %s for %s", response.status, url)
                return None
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError, OSError, ssl.SSLError) as exc:
        # Spec 4.2 makes this data opportunistic, so an outage degrades the
        # evaluation rather than failing it.
        logger.warning("NHTSA request failed (%s): %s", type(exc).__name__, url)
        return None


def _text(value: object) -> str | None:
    """vPIC returns absent fields as empty strings rather than null."""
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _int(value: object) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _float(value: object) -> float | None:
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def decode_vin(session: Session, vin: str | None, *, offline: bool = False) -> VinDecode | None:
    """Decode a VIN via vPIC, cached indefinitely.

    Returns None when the VIN is absent or fails its check digit -- spec 4.2:
    "Validate the check digit before querying, to avoid wasting calls on typos."
    """
    normalized = normalize_vin(vin)
    if normalized is None:
        return None

    cached = session.get(VinDecode, normalized)
    if cached is not None:
        return cached
    if offline:
        return None

    payload = _get_json(VPIC_DECODE_URL.format(vin=urllib.parse.quote(normalized)))
    if not payload:
        return None

    results = payload.get("Results") or []
    if not results:
        return None
    row = results[0]

    decode = VinDecode(
        vin=normalized,
        decoded_at=datetime.now(UTC),
        make=_text(row.get("Make")),
        model=_text(row.get("Model")),
        model_year=_int(row.get("ModelYear")),
        trim=_text(row.get("Trim")) or _text(row.get("Series")),
        series=_text(row.get("Series")),
        drive_type=_text(row.get("DriveType")),
        transmission=_text(row.get("TransmissionStyle")),
        engine_cylinders=_int(row.get("EngineCylinders")),
        displacement_l=_float(row.get("DisplacementL")),
        body_class=_text(row.get("BodyClass")),
        fuel_type=_text(row.get("FuelTypePrimary")),
        error_code=_text(row.get("ErrorCode")),
        raw=row,
    )
    session.add(decode)
    session.commit()
    return decode


def _fresh(lookup: VehicleSafetyLookup) -> bool:
    fetched = lookup.fetched_at
    if fetched.tzinfo is None:
        fetched = fetched.replace(tzinfo=UTC)
    return datetime.now(UTC) - fetched < timedelta(days=SAFETY_CACHE_DAYS)


def lookup_vehicle_safety(
    session: Session,
    *,
    year: int | None,
    make: str | None,
    model: str | None,
    offline: bool = False,
) -> VehicleSafetyLookup | None:
    """Recall campaigns and complaint density for a year/make/model.

    NO VIN REQUIRED, which is what makes this the half of step 6 that works on
    every listing rather than the 1-in-338 that carry a VIN. Spec 6.2 lists
    "complaint density by year/make/model (no VIN required)" separately for
    exactly this reason.

    The recall count is CAMPAIGNS FOR THE MODEL, not unrepaired recalls for this
    car. See `VehicleSafetyLookup` for why the difference matters.
    """
    if year is None or not make or not model:
        return None

    make_n = make.strip().lower()
    model_n = model.strip().lower()

    cached = session.scalars(
        select(VehicleSafetyLookup).where(
            VehicleSafetyLookup.model_year == year,
            VehicleSafetyLookup.make == make_n,
            VehicleSafetyLookup.model == model_n,
        )
    ).first()

    if cached is not None and (_fresh(cached) or offline):
        return cached
    if offline:
        return None

    params = urllib.parse.urlencode({"make": make_n, "model": model_n, "modelYear": year})
    recalls = _get_json(f"{RECALLS_URL}?{params}")
    complaints = _get_json(f"{COMPLAINTS_URL}?{params}")

    if recalls is None and complaints is None:
        # Serve stale rather than nothing: a month-old recall count is far more
        # useful than a blank, and the alternative is hammering a downed API.
        return cached

    recall_results = (recalls or {}).get("results") or []
    complaint_results = (complaints or {}).get("results") or []

    by_component = Counter(
        (entry.get("components") or "UNKNOWN").strip() for entry in complaint_results
    )

    row = cached or VehicleSafetyLookup(model_year=year, make=make_n, model=model_n)
    row.fetched_at = datetime.now(UTC)
    row.recall_count = len(recall_results)
    row.complaint_count = (complaints or {}).get("count") or len(complaint_results)
    row.complaints_by_component = dict(by_component.most_common(12))
    # Only what is needed to describe a campaign; the full payload is large and
    # mostly boilerplate.
    row.recalls = [
        {
            "component": entry.get("Component"),
            "summary": entry.get("Summary"),
            "remedy": entry.get("Remedy"),
            "campaign": entry.get("NHTSACampaignNumber"),
        }
        for entry in recall_results[:20]
    ]

    session.add(row)
    session.commit()
    return row

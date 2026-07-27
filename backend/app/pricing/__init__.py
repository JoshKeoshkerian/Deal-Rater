"""Expected ASKING price model (spec 5.1, build step 3).

Everything this package produces describes how comparable vehicles are
ADVERTISED, never what they sell for (spec 4.5). See `regression.py` for why
that distinction is load-bearing and why the naming preserves it.

Layout:

    params.py      every tunable constant, all currently UNCALIBRATED
    comps.py       comp set filtering (spec 4.3)
    tdist.py       Student's t, so the interval needs no numpy
    regression.py  mileage-adjusted fit + prediction interval
    curve.py       rise-plateau-decline residual -> pricing rating (spec 2)
    confidence.py  a separate output, never folded into the price
    model.py       orchestration
"""

from .comps import CompCandidate, CompDecision, CompSet, filter_comps
from .confidence import Confidence, ConfidenceAssessment, Limiter, assess_confidence
from .curve import PricingRating, is_calibrated, rate_price_residual
from .model import PricingAssessment, assess_listing
from .regression import AskingPriceEstimate, EstimatorKind, estimate_expected_asking_price

__all__ = [
    "AskingPriceEstimate",
    "CompCandidate",
    "CompDecision",
    "CompSet",
    "Confidence",
    "ConfidenceAssessment",
    "EstimatorKind",
    "Limiter",
    "PricingAssessment",
    "PricingRating",
    "assess_confidence",
    "assess_listing",
    "estimate_expected_asking_price",
    "filter_comps",
    "is_calibrated",
    "rate_price_residual",
]

"""Flags and completeness (spec 6.2, 6.3, build step 5).

    params.py        thresholds, all UNCALIBRATED
    completeness.py  disclosure score and title-status risk
    scam.py          spec 6.3's combination check -- deliberately not a score

Kept apart from `pricing` and `negotiation` because spec 6 requires the four
dimensions stay separated, and spec 2 forbids collapsing them: "A car with a
known transmission failure mode priced low for exactly that reason is a risky
vehicle that is fairly priced." Nothing here moves a price.
"""

from .completeness import (
    CompletenessReading,
    TitleReading,
    TitleRisk,
    assess_completeness,
    read_title_status,
)
from .scam import ScamAssessment, Signal, SignalResult, assess_scam_patterns

__all__ = [
    "CompletenessReading",
    "ScamAssessment",
    "Signal",
    "SignalResult",
    "TitleReading",
    "TitleRisk",
    "assess_completeness",
    "assess_scam_patterns",
    "read_title_status",
]

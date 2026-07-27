"""Better alternatives nearby (spec 6.5, build step 7).

Spec 6.5: "The highest-value addition to this spec, and nearly free. The comp
set is already loaded in memory at evaluation time." Nothing here fetches
anything; it ranks comps step 3 already filtered.

    params.py  thresholds, all UNCALIBRATED
    finder.py  ranking, gating and the adverse-selection exclusion
"""

from .finder import Alternative, AlternativesResult, WithheldAlternative, find_alternatives

__all__ = ["Alternative", "AlternativesResult", "WithheldAlternative", "find_alternatives"]

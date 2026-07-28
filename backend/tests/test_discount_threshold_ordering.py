"""Cross-module ordering of the three independent discount-suspicion cutoffs.

Three separately-invented constants answer three different questions about
the same signed price residual:

  IMPLAUSIBLE_DISCOUNT (pricing/params.py)      -- when the RATING gives up
  SCAM_PRICE_RESIDUAL (flags/params.py)         -- when a fraud SIGNAL fires
  ADVERSE_SELECTION_RESIDUAL (pricing/params.py) -- when CONFIDENCE drops

None reference each other in code (docs/scoring-audit.md finding #3), but
their current values already form a graduated response: confidence gets
nervous first (mildest), the scam signal fires next, and the pricing curve's
"give up on this precisely" floor is last and most extreme. This test exists
so a future edit to any one of them fails loudly here instead of silently
inverting that ordering.
"""

from __future__ import annotations

from app.flags import params as flags_params
from app.pricing import params as pricing_params


def test_discount_thresholds_form_the_intended_graduated_response():
    assert (
        pricing_params.IMPLAUSIBLE_DISCOUNT
        <= flags_params.SCAM_PRICE_RESIDUAL
        <= pricing_params.ADVERSE_SELECTION_RESIDUAL
    )

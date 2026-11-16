"""Referrals: share a link, and earn free checks when it brings someone in."""

from .service import (
    ReferralStats,
    attach_referrer,
    get_or_create_referral_code,
    maybe_reward_referrer,
    normalize_referral_code,
    referral_stats,
)

__all__ = [
    "ReferralStats",
    "attach_referrer",
    "get_or_create_referral_code",
    "maybe_reward_referrer",
    "normalize_referral_code",
    "referral_stats",
]

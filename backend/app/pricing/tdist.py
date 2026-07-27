"""Student's t distribution, in pure Python.

The backend has no numpy or scipy dependency and this is the only place one
would be needed. The two functions here are standard: a regularised incomplete
beta by continued fraction, and a bisection inverse on top of it.

Accuracy is far beyond what the model needs -- the interval it feeds is built on
eight comps -- but a lookup table was avoided so that `INTERVAL_COVERAGE` stays
a real parameter rather than one of three values someone remembered to tabulate.
"""

from __future__ import annotations

import math

_MAX_ITER = 200
_EPS = 3.0e-12


def _betacf(a: float, b: float, x: float) -> float:
    """Continued fraction for the incomplete beta function (Lentz's method)."""
    tiny = 1.0e-30
    qab, qap, qam = a + b, a + 1.0, a - 1.0

    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < tiny:
        d = tiny
    d = 1.0 / d
    h = d

    for m in range(1, _MAX_ITER + 1):
        m2 = 2 * m

        # Even step.
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < tiny:
            d = tiny
        c = 1.0 + aa / c
        if abs(c) < tiny:
            c = tiny
        d = 1.0 / d
        h *= d * c

        # Odd step.
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < tiny:
            d = tiny
        c = 1.0 + aa / c
        if abs(c) < tiny:
            c = tiny
        d = 1.0 / d
        delta = d * c
        h *= delta

        if abs(delta - 1.0) < _EPS:
            break

    return h


def regularized_incomplete_beta(a: float, b: float, x: float) -> float:
    """I_x(a, b), the regularised incomplete beta function."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0

    front = math.exp(
        math.lgamma(a + b)
        - math.lgamma(a)
        - math.lgamma(b)
        + a * math.log(x)
        + b * math.log1p(-x)
    )
    # The continued fraction converges quickly only on one side of this bound.
    if x < (a + 1.0) / (a + b + 2.0):
        return front * _betacf(a, b, x) / a
    return 1.0 - front * _betacf(b, a, 1.0 - x) / b


def t_cdf(t: float, df: float) -> float:
    """P(T <= t) for Student's t with `df` degrees of freedom."""
    if df <= 0:
        raise ValueError("degrees of freedom must be positive")
    x = df / (df + t * t)
    tail = 0.5 * regularized_incomplete_beta(df / 2.0, 0.5, x)
    return 1.0 - tail if t >= 0 else tail


def t_ppf(p: float, df: float) -> float:
    """Inverse CDF (quantile) for Student's t.

    Bisection rather than Newton: it cannot diverge, and at these sizes the cost
    is irrelevant.
    """
    if not 0.0 < p < 1.0:
        raise ValueError("p must be in (0, 1)")
    if df <= 0:
        raise ValueError("degrees of freedom must be positive")

    if p == 0.5:
        return 0.0

    lo, hi = -1.0e3, 1.0e3
    for _ in range(300):
        mid = (lo + hi) / 2.0
        if t_cdf(mid, df) < p:
            lo = mid
        else:
            hi = mid
        if hi - lo < 1.0e-10:
            break
    return (lo + hi) / 2.0


def t_two_sided(coverage: float, df: float) -> float:
    """Multiplier t* such that P(-t* <= T <= t*) == coverage."""
    return t_ppf(0.5 + coverage / 2.0, df)

"""Acquisition attribution: which ad drove an install, and what it did next.

    installs          one row per extension install, with its first-touch UTMs
    captures.install_id   every check that install ran
    users.install_id      the account it became, so purchases join back

First-party and minimal on purpose. `install_id` is a random UUID minted by the
extension on first install; it is not derived from the device, the browser or
the person, and nothing here stores an IP, an email or a user agent. The UTMs
are the ones the visitor's own click carried. See the `funnel_by_source` view
(migration 0014) for the read side.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from datetime import UTC, datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Install, User
from app.schemas import AttributionIn


def record_install(session: Session, payload: AttributionIn) -> bool:
    """Insert this install's attribution. Returns whether a row was created.

    Idempotent, and the FIRST report wins: a reload of the welcome page (or a
    replay of the request) cannot rewrite which campaign an install came from.
    """
    install_id = str(payload.install_id)
    if session.get(Install, install_id) is not None:
        return False
    session.add(
        Install(
            install_id=install_id,
            utm_source=payload.utm_source,
            utm_medium=payload.utm_medium,
            utm_campaign=payload.utm_campaign,
            utm_content=payload.utm_content,
            utm_term=payload.utm_term,
            landed_at=payload.landed_at,
            installed_at=datetime.now(UTC),
        )
    )
    try:
        session.flush()
    except IntegrityError:
        # Two concurrent first reports: the other one won, which is fine.
        session.rollback()
        return False
    return True


def link_install(user: User | None, install_id: str | None) -> None:
    """Remember which install an account came from. Set once, never replaced:
    an account signed in on a second computer keeps its first install."""
    if user is not None and install_id and user.install_id is None:
        user.install_id = install_id


class RateLimiter:
    """At most `limit` hits per `window` seconds per key, in process memory.

    Light by design: it only has to stop a script from filling `installs`
    with junk, and an attacker who spreads across instances or restarts gains
    nothing worth having. Keys are client IPs, held only in memory and only
    for the window.
    """

    def __init__(self, limit: int, window: float) -> None:
        self.limit = limit
        self.window = window
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            if len(self._hits) > 10_000:  # bound memory; drop idle keys
                self._hits = {
                    k: q for k, q in self._hits.items() if q and q[-1] > now - self.window
                }
            hits = self._hits.setdefault(key, deque())
            while hits and hits[0] <= now - self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            return True

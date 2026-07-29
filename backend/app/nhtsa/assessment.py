"""Vehicle risk from NHTSA data (spec 6.2, build step 6).

WHAT THIS CAN AND CANNOT CLAIM
------------------------------
Spec 6.2 asks for "open unrepaired safety recalls (VIN required)". NHTSA's free
public API cannot answer that. It returns recall CAMPAIGNS for a year/make/model;
whether a specific car had a campaign performed is manufacturer data behind no
free API.

So the language here is deliberately weaker than the spec's, in the same way the
pricing model says "asking price" rather than "price" (spec 4.5):

    "3 recall campaigns affect this model"        <- what we know
    "3 unrepaired recalls affect this car"        <- what we do NOT know

`RECALL_CAVEAT` carries that caveat into every output, and a test asserts the
stronger phrasing never appears.

COMPLAINT DENSITY IS NOT NORMALISED
-----------------------------------
Spec 6.2 wants "complaint density for the year/make/model relative to SEGMENT
NORMS". A raw count cannot be compared across models: 301 complaints on a
high-volume RAV4 and 30 on a low-volume peer may be the same rate, and NHTSA
publishes no sales figures to divide by.

Rather than invent a denominator, the count is reported with its component
breakdown -- which is the genuinely useful part, since "73 electrical" tells a
buyer what to inspect -- and `normalized` stays False. Establishing real segment
norms needs a corpus of lookups across peer models, which the cache accumulates
naturally as more vehicles are evaluated.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..models import VehicleSafetyLookup, VinDecode

RECALL_CAVEAT = (
    "These are recall campaigns issued for this year, make and model. Whether "
    "this particular vehicle had them performed is not public data -- ask the "
    "seller for service records, or check the VIN with a franchised dealer."
)

COMPLAINT_CAVEAT = (
    "Complaint counts are not adjusted for how many of these were sold, so they "
    "cannot be compared across models. Treat the breakdown as a list of what to "
    "inspect rather than as a quality score."
)


@dataclass(frozen=True)
class DecodedSpec:
    """VIN-decoded specification, the half of spec 4.2 that fixes comp matching."""

    vin: str
    trim: str | None
    drive_type: str | None
    transmission: str | None
    engine_cylinders: int | None
    displacement_l: float | None
    body_class: str | None
    clean_decode: bool

    @property
    def summary(self) -> str:
        parts = [
            p
            for p in (
                self.trim,
                self.drive_type,
                self.transmission,
                f"{self.displacement_l}L" if self.displacement_l else None,
                f"{self.engine_cylinders}-cyl" if self.engine_cylinders else None,
            )
            if p
        ]
        return ", ".join(parts) if parts else "decoded, but no specification returned"


@dataclass(frozen=True)
class VehicleRiskAssessment:
    """Spec 6.2's reading. Separate from pricing, and never folded into it."""

    spec: DecodedSpec | None
    recall_count: int | None
    complaint_count: int | None
    complaints_by_component: dict[str, int] = field(default_factory=dict)
    recalls: list[dict] = field(default_factory=list)
    #: False always, at this build step. See the module docstring.
    complaint_density_normalized: bool = False

    @property
    def has_data(self) -> bool:
        return self.recall_count is not None or self.spec is not None

    def top_complaint_components(self, n: int = 4) -> list[tuple[str, int]]:
        return sorted(self.complaints_by_component.items(), key=lambda kv: -kv[1])[:n]

    def recall_messages(self) -> list[str]:
        out: list[str] = []
        if self.recall_count:
            out.append(f"{self.recall_count} recall campaign(s) issued for this model.")
            out.append(RECALL_CAVEAT)
        elif self.recall_count == 0:
            out.append("No recall campaigns found for this year, make and model.")
        return out

    def complaint_messages(self) -> list[str]:
        out: list[str] = []
        if self.complaint_count:
            top = ", ".join(f"{c.lower()} ({n})" for c, n in self.top_complaint_components())
            out.append(f"{self.complaint_count} owner complaints filed. Most common: {top}.")
            out.append(COMPLAINT_CAVEAT)
        return out

    def messages(self) -> list[str]:
        return [*self.recall_messages(), *self.complaint_messages()]


def build_assessment(
    decode: VinDecode | None,
    safety: VehicleSafetyLookup | None,
) -> VehicleRiskAssessment:
    spec: DecodedSpec | None = None
    if decode is not None:
        spec = DecodedSpec(
            vin=decode.vin,
            trim=decode.trim,
            drive_type=decode.drive_type,
            transmission=decode.transmission,
            engine_cylinders=decode.engine_cylinders,
            displacement_l=float(decode.displacement_l) if decode.displacement_l else None,
            body_class=decode.body_class,
            # vPIC signals a clean decode with error code "0"; anything else
            # means the fields are partial and must not be treated as exact.
            clean_decode=decode.error_code == "0",
        )

    return VehicleRiskAssessment(
        spec=spec,
        recall_count=safety.recall_count if safety else None,
        complaint_count=safety.complaint_count if safety else None,
        complaints_by_component=dict(safety.complaints_by_component or {}) if safety else {},
        recalls=list(safety.recalls or []) if safety else [],
    )

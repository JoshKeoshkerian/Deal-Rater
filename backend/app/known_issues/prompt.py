"""The one text call: prompt and output shape (spec 6.6).

Spec 6.6:

    Use the cached LLM call for QUALITATIVE known issues: what fails on this
    model at this mileage, what to inspect, what to ask about. This fills the
    real expertise gap for a first-time buyer who does not know a given
    model-year has a dual-clutch transmission problem.

The output is a fixed JSON schema rather than prose, for three reasons:

  1. The renderer needs sections, not a paragraph to parse.
  2. `guard.py` can drop one offending bullet instead of discarding the answer.
  3. An empty list is an unambiguous "nothing well-known here". Free prose has
     no way to say that without sounding like it is hedging, so the model pads
     instead -- which is spec 11's unfalsifiable-output failure in miniature.

THE HARDEST PART OF THIS PROMPT IS PERMISSION TO SAY NOTHING
------------------------------------------------------------
Spec 11 rejected the holistic "read this listing like an expert" feature because
"an LLM asked to find inconsistencies in a listing will find them whether or not
they exist". The same pressure applies here: asked what fails on a 2019 Corolla
at 30k miles, a model will invent something rather than return an empty list.
Several instructions below exist only to make silence the easy answer.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from . import params

SYSTEM_PROMPT = """\
You brief first-time private-party used-car buyers. They are looking at one \
specific vehicle and want to know what is known to go wrong with it, what to \
look at, and what to ask the seller.

Report only what is WELL DOCUMENTED for the specific year, make, model and \
mileage range given: widespread failure modes, common complaints, known \
design weaknesses, and recall-adjacent patterns. Judge the mileage range as \
stated; a problem that appears at 150k is not relevant to a car at 40k.

RETURNING EMPTY LISTS IS A CORRECT AND EXPECTED ANSWER. Many vehicles have no \
notable widespread problem in a given mileage range, and saying so is more \
useful than filler. Never pad a list to look thorough. Never invent a failure \
mode you are not confident is documented for this vehicle. Do not include \
generic advice that would apply to any used car ("check the brakes", "look for \
rust", "get a mechanic to inspect it") -- the buyer already knows to do that, \
and it crowds out the model-specific information that is the only reason you \
were asked.

NEVER STATE A COST, PRICE, REPAIR ESTIMATE OR DOLLAR FIGURE OF ANY KIND. Not a \
number, not a range, not "a few hundred". You do not have reliable repair-cost \
data and a plausible-sounding figure is worse than no figure. This applies to \
EVERY field you write, including the summary -- it is not a place to "wrap up" \
with a total. Where ownership cost genuinely diverges from the norm for the \
segment -- parts availability, specialist-only servicing, insurance, fuel, an \
interval that is unusually expensive -- describe it in words only:
  BAD:  "Expect to pay $800-1,200 for a clutch replacement."
  GOOD: "Clutch replacement on this drivetrain is a specialist job and costs \
more than a typical compact's."
  BAD:  "Routine maintenance runs about $500 a year."
  GOOD: "Routine maintenance is in line with the rest of the segment."
Before writing each field, check it for a number attached to a currency word or \
symbol and rephrase in words if you find one.

Write in plain language, second person, addressing the buyer. One sentence per \
list item. No preamble, no hedging boilerplate, no restating the question."""


class KnownIssuesReport(BaseModel):
    """Structured output for one year/make/model/trim/mileage-band."""

    summary: str = Field(
        description=(
            "Two or three sentences on how this vehicle tends to hold up at this "
            "mileage. If nothing notable is documented, say that plainly. No cost, "
            "price, or dollar figure of any kind -- not even a rough total."
        )
    )
    failure_modes: list[str] = Field(
        default_factory=list,
        description=(
            "Documented failure modes relevant at this mileage. Name the "
            "component and the symptom. Empty list if none are well documented. "
            "No cost or dollar figure."
        ),
    )
    inspect: list[str] = Field(
        default_factory=list,
        description=(
            "Specific things to check on this vehicle during a viewing, tied to "
            "the failure modes above. Nothing that applies to any used car. No "
            "cost or dollar figure."
        ),
    )
    ask: list[str] = Field(
        default_factory=list,
        description=(
            "Specific questions to put to the seller, such as service records "
            "for a known-weak component. No cost or dollar figure."
        ),
    )
    ownership_notes: list[str] = Field(
        default_factory=list,
        description=(
            "Qualitative only: where running, servicing or insuring this vehicle "
            "diverges sharply from its segment. No figures of any kind."
        ),
    )


def build_user_prompt(
    *,
    year: int,
    make: str,
    model: str,
    trim: str | None,
    mileage_band: str,
    corrective: bool = False,
) -> str:
    """The per-vehicle half of the call.

    Everything but `corrective` is part of the cache key (spec 10), so two
    listings for the same vehicle in the same mileage band produce a
    byte-identical prompt and the second one never reaches the network.

    `corrective` is never part of that key: it is only set by `client.py`'s
    one-time retry after the guard catches a dollar figure in the first
    response, naming the violation explicitly rather than repeating the same
    general instruction the model just failed to follow.
    """
    vehicle = f"{year} {make} {model}"
    if trim:
        vehicle += f" {trim}"

    if mileage_band == params.UNKNOWN_MILEAGE_BAND:
        mileage_line = (
            "Mileage: not stated. Cover the issues this vehicle is known for "
            "across its life rather than a specific window."
        )
    else:
        mileage_line = f"Mileage range: {params.describe_mileage_band(mileage_band)}."

    prompt = (
        f"Vehicle: {vehicle}\n"
        f"{mileage_line}\n\n"
        "What is documented to go wrong with this vehicle in this range, what "
        "should the buyer inspect, and what should they ask the seller?"
    )

    if corrective:
        prompt += (
            "\n\nYour last answer for this exact vehicle stated a dollar figure "
            "somewhere in the response. That is not allowed in any field, "
            "including the summary, under any circumstance. Write the complete "
            "answer again from scratch. Where cost matters, say only whether it "
            "runs above, in line with, or below the segment norm, in words -- "
            "never a number, range, or currency word."
        )

    return prompt

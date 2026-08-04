# curbside-app

The whole website: `curbsidescore.com`. Marketing page, pricing, sign-in, saved
evaluations and account, in one Next.js app.

| Route      | What                                              | Indexed |
| ---------- | ------------------------------------------------- | ------- |
| `/`        | Landing page                                      | yes     |
| `/pricing` | Plans and FAQ                                     | yes     |
| `/privacy` | Privacy policy                                     | yes     |
| `/saved`   | Login gate, then the signed-in user's saved cards | no      |
| `/account` | Plan, remaining checks, billing history           | no      |

## This used to be two sites

`curbside-site/` was a static `index.html` on `curbsidescore.com`; this app was
`/saved` only, on `app.curbsidescore.com`. They are one project now, because
"log in to see your favourites" is not a different website from the one that
explains what favourites are — and because the header cannot show sign-in state
across a property boundary.

`curbside-site/` is left in the repo, superseded. See its README before
deleting anything.

`app.curbsidescore.com` **must stay attached to this Vercel project**: the
`has: host` redirect in `next.config.mjs` only matches requests that reach this
app, and it is what keeps already-sent sign-in emails working.

## Payments are a mockup

`/pricing` and `/account` are drawn, not wired. There is no billing anywhere in
the backend — no processor, no balance column, no subscription table, no
webhook — and no code here talks to one.

- `lib/plans.ts` — the price ladder. One definition, read by all three pages
  that mention money. Real, in the sense that these are the intended prices.
- `lib/billing.ts` — **fabricated** account state, in three fixtures. `/account`
  renders a banner saying so and offers a switcher between them, because "what
  will this look like" is the question the page exists to answer.

When a processor is chosen: plans gain price ids, `lib/billing.ts` is deleted
in favour of a fetch, and `ComingSoonDialog` goes with it.

## Auth

There is no auth code in this project beyond calling the API.

The session is an httpOnly cookie set by `api.curbsidescore.com` and scoped to
`.curbsidescore.com`, so the browser attaches it to cross-origin calls from
here on its own. That works only because both hosts share the registrable
domain: it makes them same-**site** (so `SameSite=Lax` permits the request)
while still cross-**origin** (so the API must allow this origin with
credentials).

Three consequences worth knowing:

- Every fetch **must** pass `credentials: "include"`. `lib/api.ts` is the only
  place that talks to the API, and it does this on every call.
- This page cannot read the token, by design. Whether someone is signed in is a
  question only the server can answer, which is what `GET /v1/users/me` is for.
- That question is asked **once per page load**, by `components/AuthProvider`.
  The header needs the answer on every route, and so do `/saved` and
  `/account`; three components asking independently would be three requests.

## Nothing is re-scored here

`GET /v1/users/me/saved` returns stored snapshots. Rendering that page runs no
regression, calls no external API, and costs nothing per card. Live re-scoring
of saved listings is deliberately out of scope — it also conflicts with the
user-initiated-only constraint in section 8.1 of the spec.

## Deploying

One Vercel project, root directory `curbside-app`. Set:

    NEXT_PUBLIC_API_BASE_URL=https://api.curbsidescore.com

Domains on **this** project: `curbsidescore.com`, `www.curbsidescore.com`,
`app.curbsidescore.com`. The apex and www currently sit on the `curbsideprod`
project and have to be removed there first — Vercel will not attach a domain to
two projects.

Backend env vars that must change with it:

    DEAL_RATER_APP_BASE_URL=https://curbsidescore.com     # was app.curbsidescore.com
    DEAL_RATER_CORS_ORIGINS=...,https://curbsidescore.com # add the apex; keep app. until old links die
    DEAL_RATER_SESSION_COOKIE_DOMAIN=.curbsidescore.com   # unchanged, and load-bearing

`APP_BASE_URL` is what builds the link in the sign-in email. Without the CORS
entry, every call from the apex fails and sign-in looks broken; without the
cookie domain, the cookie is host-only and sign-in appears to succeed and then
immediately fail.

## Local development

    npm install
    cp .env.example .env.local     # points at localhost:8000 by default
    npm run dev

Against a local backend, set `DEAL_RATER_SESSION_COOKIE_DOMAIN=` (empty) so the
cookie is host-only on localhost.

    npm run typecheck
    npm run build

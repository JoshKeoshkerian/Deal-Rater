# curbside-app

The saved-evaluations site: `app.curbsidescore.com`.

One real page, `/saved` — a login gate, then the signed-in user's saved
evaluations as cards, each with a Remove action.

## Why this is a separate Vercel project

`curbside-site/` (the landing page, Vercel project `curbsideprod`) is a single
static `index.html`. This is a Next.js app with a build step and a different
deploy target. Folding them together would put a build pipeline in front of a
static file for no gain, and the two are deployed independently.

## Auth

There is no auth code in this project beyond calling the API.

The session is an httpOnly cookie set by `api.curbsidescore.com` and scoped to
`.curbsidescore.com`, so the browser attaches it to cross-origin calls from
here on its own. That works only because both hosts share the registrable
domain: it makes them same-**site** (so `SameSite=Lax` permits the request)
while still cross-**origin** (so the API must allow this origin with
credentials).

Two consequences worth knowing:

- Every fetch **must** pass `credentials: "include"`. `lib/api.ts` is the only
  place that talks to the API, and it does this on every call.
- This page cannot read the token, by design. Whether someone is signed in is a
  question only the server can answer, which is what `GET /v1/users/me` is for.

## Nothing is re-scored here

`GET /v1/users/me/saved` returns stored snapshots. Rendering this page runs no
regression, calls no external API, and costs nothing per card. Live re-scoring
of saved listings is deliberately out of scope — it also conflicts with the
user-initiated-only constraint in section 8.1 of the spec.

## Deploying

Its own Vercel project, root directory `curbside-app`. Set:

    NEXT_PUBLIC_API_BASE_URL=https://api.curbsidescore.com

and point `app.curbsidescore.com` at it.

The backend needs this origin in `DEAL_RATER_CORS_ORIGINS`, and
`DEAL_RATER_SESSION_COOKIE_DOMAIN=.curbsidescore.com`. Without the second, the
cookie is host-only, this site cannot read it, and sign-in appears to succeed
and then immediately fail.

## Local development

    npm install
    cp .env.example .env.local     # points at localhost:8000 by default
    npm run dev

Against a local backend, set `DEAL_RATER_SESSION_COOKIE_DOMAIN=` (empty) so the
cookie is host-only on localhost.

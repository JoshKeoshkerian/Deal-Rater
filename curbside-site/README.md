# curbside-site — superseded

This is the old static landing page. It is **still what serves
`curbsidescore.com` until the Vercel domains are moved**, which is the only
reason it is still here.

Its content now lives in `curbside-app`:

- the markup → `curbside-app/app/page.tsx`
- the `<style>` block → `curbside-app/app/globals.css` (tokens, nav, buttons,
  footer, reveal) and `curbside-app/app/landing.css` (everything else)
- the three inline base64 screenshots → `curbside-app/public/shots/*.webp`,
  extracted byte-for-byte

## Before deleting this directory

1. Move `curbsidescore.com` and `www.curbsidescore.com` off the `curbsideprod`
   Vercel project and onto `curbside-app`. Vercel will not let one domain sit on
   two projects, so the removal has to happen first.
2. Confirm the apex serves the Next.js landing page and that `/pricing`,
   `/saved` and `/account` all resolve.
3. Then delete `curbsideprod` and this directory together.

The ported copy is not identical. Two deliberate differences:

- Every "free" CTA now names the free allowance ("10 free checks") instead of
  claiming the product is free, since evaluations are to be metered.
- There is a pricing section, which did not exist when there was nothing to sell.

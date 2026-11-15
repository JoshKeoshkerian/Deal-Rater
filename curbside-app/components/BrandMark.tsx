/**
 * The logo as the site header and footer show it: the sage car from
 * `assets/brand/curbside-mark.svg`, WITHOUT the white disc.
 *
 * The full mark is a car on a white disc. On this site's white header that
 * disc is invisible and only shrinks the car, so here the viewBox is cropped
 * to the car itself. The windows, wheel arches, hubs and check are cut out with
 * a mask rather than painted white, so they stay see-through on the footer's
 * grey background too.
 *
 * THE PATHS BELOW ARE A COPY of the source SVG's. Edit the mark there, re-run
 * `node assets/brand/render.mjs`, and update this component to match. Inline
 * rather than an <img> so the header paints with the page instead of after a
 * second request.
 *
 * `id` must differ per instance on a page (header vs footer), because the
 * mask is referenced by id.
 */

const SAGE = "#93BB99";

export function BrandMark({ height = 22, id = "brand" }: { height?: number; id?: string }) {
  const maskId = `${id}-cutouts`;
  // The car spans x 9.2-56 and y 22.1-42.2 of the 64-unit source.
  const viewBox = "9 21.6 47.2 21";
  const width = Math.round((height * 47.2) / 21);

  return (
    <svg width={width} height={height} viewBox={viewBox} aria-hidden="true">
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect width="64" height="64" fill="#fff" />
          <circle cx="17.7" cy="38.6" r="5.3" fill="#000" />
          <circle cx="46.3" cy="38.6" r="5.3" fill="#000" />
          <path d="M19.3 28.9C18.3 28.9 17.9 28 18.6 27.3C20.6 25.4 24 24.2 27.8 24.1V28.9Z" fill="#000" />
          <path d="M29.9 24.1C33.6 24.1 36.8 25 39.4 26.6L41.4 28.9H29.9Z" fill="#000" />
          <path d="M32.4 32.4L35.5 35.4L44.8 26.4" fill="none" stroke="#000" strokeWidth="2.7" />
        </mask>
      </defs>
      <g fill={SAGE}>
        <path
          mask={`url(#${maskId})`}
          d="M10.6 38.7C9.6 36.4 9.2 32 9.6 29.2C11.2 28.5 13.4 27.6 15 26.7C19 23.7 23.6 22.1 28.4 22.1C33 22.2 37 23.4 40.2 25.8L42.6 27.9C46.5 28.8 51 29.8 53.6 31.4C55.3 32.5 56 34.4 55.8 36.3L55.5 38.4C55.3 38.7 55 38.8 54.6 38.8H11.4C11 38.8 10.7 38.8 10.6 38.7Z"
        />
        <path
          fillRule="evenodd"
          d="M17.7 35a3.6 3.6 0 1 0 0 7.2a3.6 3.6 0 1 0 0-7.2zm0 2.05a1.55 1.55 0 1 1 0 3.1a1.55 1.55 0 1 1 0-3.1z"
        />
        <path
          fillRule="evenodd"
          d="M46.3 35a3.6 3.6 0 1 0 0 7.2a3.6 3.6 0 1 0 0-7.2zm0 2.05a1.55 1.55 0 1 1 0 3.1a1.55 1.55 0 1 1 0-3.1z"
        />
      </g>
    </svg>
  );
}

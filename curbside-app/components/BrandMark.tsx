/**
 * The wordmark and its logo, lifted verbatim from the landing page's inline
 * SVG so the two do not drift apart now that they share a codebase.
 */

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#081D36" />
      <path
        d="M12 39.5c0-1.1.5-1.8 1.5-2l4.4-1 5.6-6.8c.8-1 1.9-1.5 3.2-1.5h11.6c1.1 0 2.1.4 2.9 1.1l6.3 5.7 4 1.4c1.1.4 1.6 1.1 1.6 2.1v4c0 1-.6 1.6-1.6 1.6H13.6c-1 0-1.6-.6-1.6-1.6v-3z"
        fill="#16A47D"
      />
      <circle cx="23" cy="43.5" r="5.6" fill="#16A47D" stroke="#081D36" strokeWidth="2.4" />
      <circle cx="45" cy="43.5" r="5.6" fill="#16A47D" stroke="#081D36" strokeWidth="2.4" />
      <path d="M26.5 30h7.2v6.2H21.5z" fill="#081D36" />
      <path d="M36.2 30h4.4l5.6 6.2h-10z" fill="#081D36" />
      <path
        d="M33.5 41l4.2 4.2 9-9.2"
        stroke="#C2E85C"
        strokeWidth="4.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  async redirects() {
    return [
      /**
       * `app.curbsidescore.com` is gone as a destination but not as an address.
       * Old bookmarks point at it, and — the reason this is a redirect rather
       * than a deleted DNS record — so does every sign-in email already sent,
       * whose links are `{DEAL_RATER_APP_BASE_URL}/saved?email=&code=`.
       *
       * Point that env var at the apex (see the deploy notes in README.md) and
       * this rule catches the mail already sitting in inboxes. Query strings
       * survive a Next redirect, so a magic link still lands on /saved carrying
       * its code.
       *
       * 308 rather than 307: the move is permanent, and that is what tells
       * search engines the apex is canonical.
       *
       * This only fires for requests that actually reach this app, so
       * app.curbsidescore.com must stay attached to this Vercel project.
       */
      {
        source: "/:path*",
        has: [{ type: "host", value: "app.curbsidescore.com" }],
        destination: "https://curbsidescore.com/:path*",
        permanent: true,
      },
      /** The static landing page was served as index.html. */
      {
        source: "/index.html",
        destination: "/",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;

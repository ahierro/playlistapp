import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * We browse through http://127.0.0.1:3000 but the Next dev server believes it
   * is `localhost`, so it treats HMR as a cross-origin request and blocks it.
   * Without this there is no hot reload.
   */
  allowedDevOrigins: ["127.0.0.1"],

  images: {
    // Hosts from which Spotify serves artist and profile pictures.
    remotePatterns: [
      { protocol: "https", hostname: "i.scdn.co" },
      { protocol: "https", hostname: "mosaic.scdn.co" },
      { protocol: "https", hostname: "*.spotifycdn.com" },
      { protocol: "https", hostname: "*.fbsbx.com" },
    ],
  },

  /**
   * Spotify does NOT accept `localhost` as a redirect URI: you have to register
   * the literal IP `127.0.0.1`. But Auth.js builds the `redirect_uri` from the
   * request host, so if you enter through http://localhost:3000 it sends
   * `redirect_uri=http://localhost:3000/...` and Spotify answers
   * "redirect_uri: Not matching configuration".
   *
   * This redirect sends any request on localhost to 127.0.0.1 in dev, so the
   * login flow does not depend on how you typed the URL.
   */
  async redirects() {
    if (process.env.NODE_ENV !== "development") return [];

    const port = process.env.PORT ?? "3000";

    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "localhost" }],
        destination: `http://127.0.0.1:${port}/:path*`,
        permanent: false,
      },
    ];
  },
};

export default nextConfig;

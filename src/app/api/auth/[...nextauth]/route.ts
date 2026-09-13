import type { NextRequest } from "next/server";

import { handlers } from "@/auth";

/**
 * Why this wrapper exists.
 *
 * Spotify does NOT accept `localhost` as a redirect URI: it requires the literal
 * IP (`http://127.0.0.1:3000/...`). But the Next 16 dev server normalizes
 * `request.url` to `http://localhost:PORT` even when the `Host` header says
 * `127.0.0.1`, and Auth.js derives the `redirect_uri` from that URL
 * (`parseProviders` uses `params.url.origin`). Result: Spotify answers
 * "redirect_uri: Not matching configuration".
 *
 * We rewrite the origin exactly once, here, before handing the request to
 * Auth.js. That keeps the authorize and the token exchange consistent -- which is
 * precisely what Spotify validates -- because both come from `provider.callbackUrl`,
 * derived from this same origin.
 *
 * Only applies in development: in production you serve over HTTPS with a real domain.
 */
const DEV_ORIGIN = process.env.AUTH_DEV_ORIGIN ?? "http://127.0.0.1:3000";

type Handler = (request: NextRequest) => Promise<Response>;

function withDevOrigin(handler: Handler): Handler {
  if (process.env.NODE_ENV !== "development") return handler;

  // next-auth's `reqWithEnvURL` reads `req.nextUrl` when AUTH_URL is set, and
  // below we pass a plain `Request` that does not have it. Besides, AUTH_URL does
  // not solve this problem (see the `Request` comment further down), so if
  // somebody sets it we would rather touch nothing than break with a TypeError.
  if (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL) {
    console.warn(
      "[auth] AUTH_URL is set: skipping the origin rewrite. " +
        "If Spotify rejects the redirect_uri, remove AUTH_URL and use AUTH_DEV_ORIGIN.",
    );
    return handler;
  }

  return async (request: NextRequest) => {
    const url = new URL(request.url);

    if (url.hostname !== "localhost") return handler(request);

    const target = new URL(DEV_ORIGIN);
    url.protocol = target.protocol;
    url.hostname = target.hostname;
    url.port = target.port;

    const method = request.method.toUpperCase();
    const hasBody = method !== "GET" && method !== "HEAD";

    /**
     * It has to be a plain `Request`. `new NextRequest(url, init)` normalizes the
     * origin back to `localhost` -- verified -- and that is also why `AUTH_URL`
     * does not work: `reqWithEnvURL` builds exactly a `NextRequest`.
     * Auth.js only reads url/method/headers/body from this object.
     */
    const rewritten = new Request(url, {
      method: request.method,
      headers: request.headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
    });

    return handler(rewritten as unknown as NextRequest);
  };
}

export const GET = withDevOrigin(handlers.GET);
export const POST = withDevOrigin(handlers.POST);

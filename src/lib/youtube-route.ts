import { NextResponse } from "next/server";

import { auth } from "@/auth-youtube";
import { YouTubeApiError, YouTubeAuthError } from "@/lib/youtube";

/**
 * Shared plumbing for the `/api/youtube/*` routes: session guard and error
 * mapping. The Google access token never leaves the server.
 */
export async function withYouTubeSession(
  label: string,
  handler: (accessToken: string) => Promise<Response>,
): Promise<Response> {
  const session = await auth();

  if (!session?.accessToken || session.error) {
    return NextResponse.json(
      { error: "No valid YouTube Music session" },
      { status: 401 },
    );
  }

  try {
    return await handler(session.accessToken);
  } catch (error) {
    if (error instanceof InvalidPageTokenError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof YouTubeAuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    // Forward the real status so the client can tell a missing permission (403)
    // or an exhausted quota (429) apart from a generic upstream failure.
    if (error instanceof YouTubeApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error(`[${label}]`, error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unexpected YouTube error",
      },
      { status: 502 },
    );
  }
}

/** A page token the route refuses. Answered as 400, never silently ignored. */
export class InvalidPageTokenError extends Error {
  constructor() {
    super("Invalid page token");
    this.name = "InvalidPageTokenError";
  }
}

/**
 * Page tokens are opaque: YouTube does not document their alphabet, so only the
 * length and printable ASCII are checked (the value is URL-encoded when it is
 * forwarded). An earlier, stricter check silently dropped valid tokens, which
 * made the route serve page 1 again and cut every list short.
 */
export function readPageToken(request: Request): string | null {
  const token = new URL(request.url).searchParams.get("pageToken");
  if (!token) return null;
  if (!/^[\x21-\x7E]{1,512}$/.test(token)) throw new InvalidPageTokenError();
  return token;
}

/**
 * Guard for the routes that change the user's YouTube account. The session
 * cookie is `SameSite=Lax`, which already keeps most cross-site POSTs out; this
 * also refuses anything the browser marks as coming from another site.
 */
export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;

  const origin = request.headers.get("origin");
  if (!origin) return fetchSite === "same-origin";

  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

export function forbiddenOrigin() {
  return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
}

/** Reads a JSON body, answering 400 on anything that is not an object. */
export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown> | null> {
  const body: unknown = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export const PLAYLIST_ID_PATTERN = /^[\w-]{1,100}$/;
export const VIDEO_ID_PATTERN = /^[\w-]{11}$/;

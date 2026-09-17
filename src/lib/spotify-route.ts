import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { SpotifyApiError, SpotifyAuthError } from "@/lib/spotify";

/**
 * Shared plumbing for the Spotify routes that write or search: session guard
 * and error mapping. A 429 carries `retryAfter` (seconds) so the copy queue can
 * wait and carry on.
 */
export async function withSpotifySession(
  label: string,
  handler: (accessToken: string) => Promise<Response>,
): Promise<Response> {
  const session = await auth();

  if (!session?.accessToken || session.error) {
    return NextResponse.json(
      { error: "No valid Spotify session" },
      { status: 401 },
    );
  }

  try {
    return await handler(session.accessToken);
  } catch (error) {
    if (error instanceof SpotifyAuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    if (error instanceof SpotifyApiError) {
      return NextResponse.json(
        { error: error.message, retryAfter: error.retryAfter },
        {
          status: error.status,
          headers: error.retryAfter
            ? { "Retry-After": String(error.retryAfter) }
            : undefined,
        },
      );
    }

    console.error(`[${label}]`, error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unexpected Spotify error",
      },
      { status: 502 },
    );
  }
}

export const SPOTIFY_URI_PATTERN = /^spotify:track:[A-Za-z0-9]{22}$/;
export const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;

/** `uris` from a JSON body: 1 to 100 track URIs, or null. */
export function readTrackUris(body: Record<string, unknown> | null): string[] | null {
  const uris = body?.uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 100) return null;
  return uris.every((uri) => typeof uri === "string" && SPOTIFY_URI_PATTERN.test(uri))
    ? (uris as string[])
    : null;
}

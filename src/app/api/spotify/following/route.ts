import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getFollowedArtists, SpotifyApiError, SpotifyAuthError } from "@/lib/spotify";

/**
 * Endpoint the client uses to request the following pages.
 * The access token never leaves the server: it travels in the session cookie.
 */
export async function GET(request: Request) {
  const session = await auth();

  if (!session?.accessToken || session.error) {
    return NextResponse.json(
      { error: "No valid Spotify session" },
      { status: 401 },
    );
  }

  const after = new URL(request.url).searchParams.get("after");

  try {
    const page = await getFollowedArtists(session.accessToken, { after });
    return NextResponse.json(page);
  } catch (error) {
    if (error instanceof SpotifyAuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    // Forward the real status so the client can tell a missing scope (403) or a
    // rate limit (429) apart from a generic upstream failure.
    if (error instanceof SpotifyApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[api/spotify/following]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unexpected Spotify error",
      },
      { status: 502 },
    );
  }
}

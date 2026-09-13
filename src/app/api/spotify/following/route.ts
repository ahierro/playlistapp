import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getFollowedArtists, SpotifyAuthError } from "@/lib/spotify";

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

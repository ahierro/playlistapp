import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  getPlaylistItems,
  SpotifyApiError,
  SpotifyAuthError,
} from "@/lib/spotify";

/**
 * One page of a playlist's contents, for the JSON export.
 *
 * The client walks these pages so it can show progress and stay off the serverless
 * time limit; doing the whole export in a single request would mean one function
 * call fetching thousands of tracks.
 *
 * A 403 here means the playlist is not the user's and not collaborative, which
 * Spotify does not let us read at all. It is forwarded as-is so the client can skip
 * that one playlist and carry on.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();

  if (!session?.accessToken || session.error) {
    return NextResponse.json(
      { error: "No valid Spotify session" },
      { status: 401 },
    );
  }

  const { id } = await params;
  const offsetParam = new URL(request.url).searchParams.get("offset");
  const offset = Number(offsetParam ?? 0);

  if (!Number.isFinite(offset) || offset < 0) {
    return NextResponse.json({ error: "Invalid offset" }, { status: 400 });
  }

  try {
    const page = await getPlaylistItems(session.accessToken, id, { offset });
    return NextResponse.json(page);
  } catch (error) {
    if (error instanceof SpotifyAuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    if (error instanceof SpotifyApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[api/spotify/playlists/:id/tracks]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unexpected Spotify error",
      },
      { status: 502 },
    );
  }
}

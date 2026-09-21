import { NextResponse } from "next/server";

import { getSavedTrackArtistRefs } from "@/lib/spotify";
import { withSpotifySession } from "@/lib/spotify-route";
import { badRequest } from "@/lib/youtube-route";

/**
 * One page of the artists credited on the liked songs.
 *
 * Needs the `user-library-read` scope. Sessions created before it was added do
 * not have it and Spotify answers 403, which the client reports as a missing
 * permission rather than failing the whole scan.
 */
export async function GET(request: Request) {
  const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
  if (!Number.isFinite(offset) || offset < 0) return badRequest("Invalid offset");

  return withSpotifySession("api/spotify/saved-tracks/artists", async (token) => {
    const page = await getSavedTrackArtistRefs(token, { offset });
    return NextResponse.json(page);
  });
}

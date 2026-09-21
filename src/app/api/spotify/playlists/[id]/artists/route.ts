import { NextResponse } from "next/server";

import { getPlaylistArtistRefs } from "@/lib/spotify";
import { withSpotifySession } from "@/lib/spotify-route";
import { badRequest } from "@/lib/youtube-route";

/**
 * One page of the artists credited on a playlist's songs.
 *
 * The client walks these pages so it can show progress and stay off the
 * serverless time limit. A 403 means the playlist is neither the user's nor
 * collaborative, which Spotify does not let us read; it is forwarded as-is so
 * the scan can skip that playlist and carry on.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
  if (!Number.isFinite(offset) || offset < 0) return badRequest("Invalid offset");

  return withSpotifySession("api/spotify/playlists/:id/artists", async (token) => {
    const page = await getPlaylistArtistRefs(token, id, { offset });
    return NextResponse.json(page);
  });
}

import { NextResponse } from "next/server";

import { getSpotifyTrack } from "@/lib/spotify";
import { withSpotifySession } from "@/lib/spotify-route";
import { badRequest } from "@/lib/youtube-route";

/** One track's name and artists, for a link pasted during review. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[A-Za-z0-9]{22}$/.test(id)) return badRequest("Invalid track id");

  return withSpotifySession("api/spotify/tracks/:id", async (token) =>
    NextResponse.json(await getSpotifyTrack(token, id)),
  );
}

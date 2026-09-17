import { NextResponse } from "next/server";

import { getYouTubePlaylistItems } from "@/lib/youtube";
import { readPageToken, withYouTubeSession } from "@/lib/youtube-route";

/**
 * One page of a playlist's songs, for the JSON export. The client walks the
 * pages so it can show progress and stay off the serverless time limit.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!/^[\w-]{1,100}$/.test(id)) {
    return NextResponse.json({ error: "Invalid playlist id" }, { status: 400 });
  }

  return withYouTubeSession(
    "api/youtube/playlists/:id/items",
    async (accessToken) => {
      const page = await getYouTubePlaylistItems(accessToken, id, {
        pageToken: readPageToken(request),
      });
      return NextResponse.json(page);
    },
  );
}

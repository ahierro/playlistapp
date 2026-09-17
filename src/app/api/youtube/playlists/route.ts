import { NextResponse } from "next/server";

import { getYouTubePlaylists } from "@/lib/youtube";
import { readPageToken, withYouTubeSession } from "@/lib/youtube-route";

/** One page of the user's own YouTube playlists (plus "Liked videos" on the first). */
export async function GET(request: Request) {
  return withYouTubeSession("api/youtube/playlists", async (accessToken) => {
    const page = await getYouTubePlaylists(accessToken, {
      pageToken: readPageToken(request),
    });
    return NextResponse.json(page);
  });
}

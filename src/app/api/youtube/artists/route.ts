import { NextResponse } from "next/server";

import { getYouTubeArtists } from "@/lib/youtube";
import { readPageToken, withYouTubeSession } from "@/lib/youtube-route";

/** One page of subscribed artist channels. */
export async function GET(request: Request) {
  return withYouTubeSession("api/youtube/artists", async (accessToken) => {
    const page = await getYouTubeArtists(accessToken, {
      pageToken: readPageToken(request),
    });
    return NextResponse.json(page);
  });
}

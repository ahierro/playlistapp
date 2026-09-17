import { NextResponse } from "next/server";

import { getPlaylistVideoIds } from "@/lib/youtube";
import {
  badRequest,
  PLAYLIST_ID_PATTERN,
  readPageToken,
  withYouTubeSession,
} from "@/lib/youtube-route";

/** One page of the video ids already in a playlist (1 quota unit per page). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!PLAYLIST_ID_PATTERN.test(id)) return badRequest("Invalid playlist id");

  return withYouTubeSession(
    "api/youtube/playlists/:id/video-ids",
    async (accessToken) => {
      const page = await getPlaylistVideoIds(accessToken, id, {
        pageToken: readPageToken(request),
      });
      return NextResponse.json(page);
    },
  );
}

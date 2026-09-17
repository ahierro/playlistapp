import { NextResponse } from "next/server";

import { addVideoToPlaylist, getYouTubePlaylistItems } from "@/lib/youtube";
import {
  badRequest,
  forbiddenOrigin,
  isSameOriginRequest,
  PLAYLIST_ID_PATTERN,
  readJsonObject,
  readPageToken,
  VIDEO_ID_PATTERN,
  withYouTubeSession,
} from "@/lib/youtube-route";

type Params = { params: Promise<{ id: string }> };

/**
 * One page of a playlist's songs, for the JSON export. The client walks the
 * pages so it can show progress and stay off the serverless time limit.
 */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  if (!PLAYLIST_ID_PATTERN.test(id)) return badRequest("Invalid playlist id");

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

/** Adds one video. Body: { videoId }. 50 quota units. */
export async function POST(request: Request, { params }: Params) {
  if (!isSameOriginRequest(request)) return forbiddenOrigin();

  const { id } = await params;
  if (!PLAYLIST_ID_PATTERN.test(id)) return badRequest("Invalid playlist id");

  const body = await readJsonObject(request);
  const videoId = typeof body?.videoId === "string" ? body.videoId : "";
  if (!VIDEO_ID_PATTERN.test(videoId)) return badRequest("Invalid videoId");

  return withYouTubeSession(
    "api/youtube/playlists/:id/items POST",
    async (accessToken) => {
      const item = await addVideoToPlaylist(accessToken, id, videoId);
      return NextResponse.json(item, { status: 201 });
    },
  );
}

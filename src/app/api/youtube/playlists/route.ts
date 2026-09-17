import { NextResponse } from "next/server";

import {
  createYouTubePlaylist,
  getYouTubePlaylists,
  type PrivacyStatus,
} from "@/lib/youtube";
import {
  badRequest,
  forbiddenOrigin,
  isSameOriginRequest,
  readJsonObject,
  readPageToken,
  withYouTubeSession,
} from "@/lib/youtube-route";

/** One page of the user's own YouTube playlists (plus "Liked videos" on the first). */
export async function GET(request: Request) {
  return withYouTubeSession("api/youtube/playlists", async (accessToken) => {
    const page = await getYouTubePlaylists(accessToken, {
      pageToken: readPageToken(request),
    });
    return NextResponse.json(page);
  });
}

const PRIVACY: PrivacyStatus[] = ["private", "unlisted", "public"];

/** Creates a playlist. Body: { title, description?, privacyStatus }. 50 quota units. */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return forbiddenOrigin();

  const body = await readJsonObject(request);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description =
    typeof body?.description === "string" ? body.description : undefined;
  const privacyStatus = body?.privacyStatus as PrivacyStatus;

  if (!title) return badRequest("A title is required");
  if (!PRIVACY.includes(privacyStatus)) return badRequest("Invalid privacyStatus");

  return withYouTubeSession("api/youtube/playlists POST", async (accessToken) => {
    const playlist = await createYouTubePlaylist(accessToken, {
      title,
      description,
      privacyStatus,
    });
    return NextResponse.json(playlist, { status: 201 });
  });
}

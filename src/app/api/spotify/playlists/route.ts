import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  createSpotifyPlaylist,
  getUserPlaylists,
  SpotifyApiError,
  SpotifyAuthError,
} from "@/lib/spotify";
import { withSpotifySession } from "@/lib/spotify-route";
import {
  badRequest,
  forbiddenOrigin,
  isSameOriginRequest,
  readJsonObject,
} from "@/lib/youtube-route";

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.accessToken || session.error) {
    return NextResponse.json(
      { error: "No valid Spotify session" },
      { status: 401 },
    );
  }

  const offsetParam = new URL(request.url).searchParams.get("offset");
  const offset = Number(offsetParam ?? 0);

  if (!Number.isFinite(offset) || offset < 0) {
    return NextResponse.json({ error: "Invalid offset" }, { status: 400 });
  }

  try {
    const page = await getUserPlaylists(session.accessToken, { offset });
    return NextResponse.json(page);
  } catch (error) {
    if (error instanceof SpotifyAuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    // Forward the real status so the client can tell a missing scope (403) or a
    // rate limit (429) apart from a generic upstream failure.
    if (error instanceof SpotifyApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[api/spotify/playlists]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unexpected Spotify error",
      },
      { status: 502 },
    );
  }
}

/**
 * Creates a playlist. Body: { title, description?, privacyStatus }.
 * Spotify has no "unlisted": anything but "public" is private.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return forbiddenOrigin();

  const body = await readJsonObject(request);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description =
    typeof body?.description === "string" ? body.description : undefined;
  if (!title) return badRequest("A title is required");

  return withSpotifySession("api/spotify/playlists POST", async (accessToken) => {
    const playlist = await createSpotifyPlaylist(accessToken, {
      name: title,
      description,
      isPublic: body?.privacyStatus === "public",
    });
    return NextResponse.json(
      { id: playlist.id, title: playlist.name },
      { status: 201 },
    );
  });
}

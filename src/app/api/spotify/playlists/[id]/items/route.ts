import { NextResponse } from "next/server";

import {
  addTracksToSpotifyPlaylist,
  getSpotifyPlaylistUris,
  removeTracksFromSpotifyPlaylist,
} from "@/lib/spotify";
import {
  readTrackUris,
  SPOTIFY_ID_PATTERN,
  withSpotifySession,
} from "@/lib/spotify-route";
import {
  badRequest,
  forbiddenOrigin,
  isSameOriginRequest,
  readJsonObject,
} from "@/lib/youtube-route";

type Params = { params: Promise<{ id: string }> };

/** One page of the track URIs already in the playlist (`?offset=`). */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  if (!SPOTIFY_ID_PATTERN.test(id)) return badRequest("Invalid playlist id");

  const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
  if (!Number.isInteger(offset) || offset < 0) return badRequest("Invalid offset");

  return withSpotifySession("api/spotify/playlists/:id/items", async (token) =>
    NextResponse.json(await getSpotifyPlaylistUris(token, id, { offset })),
  );
}

/** Appends tracks. Body: { uris } (1-100 spotify:track: URIs). */
export async function POST(request: Request, { params }: Params) {
  if (!isSameOriginRequest(request)) return forbiddenOrigin();
  const { id } = await params;
  if (!SPOTIFY_ID_PATTERN.test(id)) return badRequest("Invalid playlist id");

  const uris = readTrackUris(await readJsonObject(request));
  if (!uris) return badRequest("Invalid uris");

  return withSpotifySession("api/spotify/playlists/:id/items POST", async (token) => {
    await addTracksToSpotifyPlaylist(token, id, uris);
    return NextResponse.json({ added: uris.length }, { status: 201 });
  });
}

/** Removes tracks. Body: { uris }. */
export async function DELETE(request: Request, { params }: Params) {
  if (!isSameOriginRequest(request)) return forbiddenOrigin();
  const { id } = await params;
  if (!SPOTIFY_ID_PATTERN.test(id)) return badRequest("Invalid playlist id");

  const uris = readTrackUris(await readJsonObject(request));
  if (!uris) return badRequest("Invalid uris");

  return withSpotifySession("api/spotify/playlists/:id/items DELETE", async (token) => {
    await removeTracksFromSpotifyPlaylist(token, id, uris);
    return new NextResponse(null, { status: 204 });
  });
}

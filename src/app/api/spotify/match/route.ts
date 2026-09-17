import { NextResponse } from "next/server";

import { findTrackOnSpotify } from "@/lib/spotify";
import { withSpotifySession } from "@/lib/spotify-route";
import {
  badRequest,
  forbiddenOrigin,
  isSameOriginRequest,
  readJsonObject,
} from "@/lib/youtube-route";

/** Finds the Spotify track for a song. Body: { name, artists, durationMs? }. */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return forbiddenOrigin();

  const body = await readJsonObject(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const artists = Array.isArray(body?.artists)
    ? body.artists.filter((a): a is string => typeof a === "string").slice(0, 10)
    : [];
  const durationMs =
    typeof body?.durationMs === "number" && Number.isFinite(body.durationMs)
      ? body.durationMs
      : null;

  if (!name || name.length > 300) return badRequest("Invalid track name");

  return withSpotifySession("api/spotify/match", async (token) =>
    NextResponse.json({
      match: await findTrackOnSpotify(token, { name, artists, durationMs }),
    }),
  );
}

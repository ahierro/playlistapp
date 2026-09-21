import { NextResponse } from "next/server";

import { findTrackOnYouTube } from "@/lib/youtube";
import {
  badRequest,
  forbiddenOrigin,
  isSameOriginRequest,
  readJsonObject,
  withYouTubeSession,
} from "@/lib/youtube-route";

/**
 * Finds the YouTube video for one track. Body: { name, artists, durationMs? }.
 * POST because it spends one of the day's 100 searches: it must not be
 * triggered by a prefetch or a cross-site link.
 */
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

  return withYouTubeSession("api/youtube/match", async (accessToken) => {
    const result = await findTrackOnYouTube(accessToken, {
      name,
      artists,
      durationMs,
    });
    return NextResponse.json(result);
  });
}

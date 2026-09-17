import { NextResponse } from "next/server";

import { followSpotifyArtists, searchArtists } from "@/lib/spotify";
import { withSpotifySession } from "@/lib/spotify-route";
import { artistKey } from "@/lib/artist-compare";
import {
  badRequest,
  forbiddenOrigin,
  isSameOriginRequest,
  readJsonObject,
} from "@/lib/youtube-route";

/**
 * Follows an artist by name: searches Spotify, keeps the result whose name
 * matches, and saves it to the library (February 2026 moved following there).
 * Body: { name }.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return forbiddenOrigin();

  const body = await readJsonObject(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 200) return badRequest("Invalid artist name");

  return withSpotifySession("api/spotify/follow", async (accessToken) => {
    const wanted = artistKey(name);
    const hits = await searchArtists(accessToken, name);
    const artist = hits.find((hit) => artistKey(hit.name) === wanted);

    if (!artist) {
      return NextResponse.json(
        {
          error: `Spotify has no artist called “${name}”.`,
          suggestions: hits.slice(0, 5).map((hit) => hit.name),
        },
        { status: 404 },
      );
    }

    await followSpotifyArtists(accessToken, [artist.uri]);
    return NextResponse.json({
      name: artist.name,
      url: artist.url,
      imageUrl: artist.imageUrl,
    });
  });
}

import { NextResponse } from "next/server";

import { followSpotifyArtists, getSpotifyArtist, searchArtists } from "@/lib/spotify";
import { withSpotifySession } from "@/lib/spotify-route";
import { artistKey } from "@/lib/artist-compare";
import {
  badRequest,
  forbiddenOrigin,
  isSameOriginRequest,
  readJsonObject,
} from "@/lib/youtube-route";

const ARTIST_URI_PATTERN = /^spotify:artist:[A-Za-z0-9]{22}$/;

/**
 * Follows an artist and saves it to the library (February 2026 moved following
 * there). Body: either { uri }, when the caller already knows exactly which
 * artist it means, or { name }, which is searched and matched by name.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return forbiddenOrigin();

  const body = await readJsonObject(request);

  // An exact URI needs no search: it comes from the user's own songs.
  const uri = typeof body?.uri === "string" ? body.uri.trim() : "";
  if (uri) {
    if (!ARTIST_URI_PATTERN.test(uri)) return badRequest("Invalid artist URI");

    return withSpotifySession("api/spotify/follow", async (accessToken) => {
      await followSpotifyArtists(accessToken, [uri]);
      // The name and picture are only for the confirmation, so a failed lookup
      // must not undo a follow that already went through.
      const artist = await getSpotifyArtist(
        accessToken,
        uri.slice("spotify:artist:".length),
      ).catch(() => null);

      return NextResponse.json({
        name: artist?.name ?? "",
        url: artist?.url ?? `https://open.spotify.com/artist/${uri.slice(15)}`,
        imageUrl: artist?.imageUrl ?? null,
      });
    });
  }

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

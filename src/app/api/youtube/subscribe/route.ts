import { NextResponse } from "next/server";

import { artistKey } from "@/lib/artist-compare";
import { searchChannels, subscribeToChannel } from "@/lib/youtube";
import {
  badRequest,
  forbiddenOrigin,
  isSameOriginRequest,
  readJsonObject,
  withYouTubeSession,
} from "@/lib/youtube-route";

/**
 * Subscribes to an artist's channel by name: searches YouTube (100 quota
 * units), keeps the channel whose name matches, and subscribes (50 units).
 * Body: { name }.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return forbiddenOrigin();

  const body = await readJsonObject(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 200) return badRequest("Invalid artist name");

  return withYouTubeSession("api/youtube/subscribe", async (accessToken) => {
    const wanted = artistKey(name);
    const hits = await searchChannels(accessToken, name);

    // The auto-generated "Name - Topic" channel is the artist's own; an
    // official channel with the same name is just as good.
    const channel =
      hits.find((hit) => /\s-\s+topic$/iu.test(hit.title) && artistKey(hit.title) === wanted) ??
      hits.find((hit) => artistKey(hit.title) === wanted);

    if (!channel) {
      return NextResponse.json(
        {
          error: `YouTube has no channel called “${name}”.`,
          suggestions: hits.slice(0, 5).map((hit) => hit.title),
        },
        { status: 404 },
      );
    }

    await subscribeToChannel(accessToken, channel.channelId);
    return NextResponse.json({
      name: channel.title,
      url: `https://music.youtube.com/channel/${encodeURIComponent(channel.channelId)}`,
      imageUrl: channel.imageUrl,
    });
  });
}

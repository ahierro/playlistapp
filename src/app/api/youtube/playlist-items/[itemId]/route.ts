import { NextResponse } from "next/server";

import { removePlaylistItem } from "@/lib/youtube";
import {
  badRequest,
  forbiddenOrigin,
  isSameOriginRequest,
  withYouTubeSession,
} from "@/lib/youtube-route";

/** Removes one entry from a playlist (50 quota units). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  if (!isSameOriginRequest(request)) return forbiddenOrigin();

  const { itemId } = await params;
  if (!/^[\w-]{1,200}$/.test(itemId)) return badRequest("Invalid item id");

  return withYouTubeSession(
    "api/youtube/playlist-items/:itemId DELETE",
    async (accessToken) => {
      await removePlaylistItem(accessToken, itemId);
      return new NextResponse(null, { status: 204 });
    },
  );
}

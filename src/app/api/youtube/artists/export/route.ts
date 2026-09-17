import { NextResponse } from "next/server";

import { getAllYouTubeArtists } from "@/lib/youtube";
import { withYouTubeSession } from "@/lib/youtube-route";

/** Downloads a .txt with every subscribed artist, alphabetically. */
export async function GET() {
  return withYouTubeSession("api/youtube/artists/export", async (accessToken) => {
    const artists = await getAllYouTubeArtists(accessToken);

    // CRLF and BOM so the file opens correctly in Windows Notepad.
    const body = "﻿" + artists.map((a) => a.name).join("\r\n") + "\r\n";
    const date = new Date().toISOString().slice(0, 10);

    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="youtube-music-artists-${date}.txt"`,
        "Cache-Control": "no-store",
      },
    });
  });
}

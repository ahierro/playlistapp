import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  getAllFollowedArtists,
  sortArtistsByName,
  SpotifyAuthError,
} from "@/lib/spotify";

/**
 * Downloads a .txt with EVERY followed artist, in alphabetical order.
 *
 * It paginates on the server instead of exporting whatever the client has
 * loaded, so the file is always complete no matter how many times
 * you pressed "Load more".
 */
export async function GET() {
  const session = await auth();

  if (!session?.accessToken || session.error) {
    return NextResponse.json(
      { error: "No valid Spotify session" },
      { status: 401 },
    );
  }

  try {
    const artists = sortArtistsByName(
      await getAllFollowedArtists(session.accessToken),
    );

    // CRLF and BOM so that the file opens correctly in Windows Notepad,
    // accented characters included.
    const body = "﻿" + artists.map((a) => a.name).join("\r\n") + "\r\n";

    const date = new Date().toISOString().slice(0, 10);

    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="followed-artists-${date}.txt"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof SpotifyAuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    console.error("[api/spotify/following/export]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unexpected Spotify error",
      },
      { status: 502 },
    );
  }
}

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getUserPlaylists, SpotifyAuthError } from "@/lib/spotify";

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

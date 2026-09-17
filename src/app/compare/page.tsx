import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { CompareArtists } from "@/components/compare-artists";
import { getAccounts } from "@/lib/accounts";
import { SERVICE_LABELS, type MusicService } from "@/lib/music";

/**
 * Artists followed on one service and missing on the other. Needs both
 * accounts, and both complete lists downloaded (they live in localStorage).
 */
export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ side?: string }>;
}) {
  const accounts = await getAccounts();
  const spotify = accounts.spotify;
  const youtube = accounts["youtube-music"];

  if (!spotify || !youtube) {
    redirect("/");
  }

  const { side: sideParam } = await searchParams;
  const side: MusicService =
    sideParam === "youtube-music" ? "youtube-music" : "spotify";
  const other: MusicService =
    side === "spotify" ? "youtube-music" : "spotify";

  return (
    <AppShell
      accounts={accounts}
      theme={other === "youtube-music" ? "youtube" : "spotify"}
      title={`Only on ${SERVICE_LABELS[side]}`}
    >
      <CompareArtists
        side={side}
        spotifyUserId={spotify.id}
        youtubeUserId={youtube.id}
      />
    </AppShell>
  );
}

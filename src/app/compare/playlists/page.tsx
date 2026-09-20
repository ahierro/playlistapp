import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { ComparePlaylists } from "@/components/compare-playlists";
import { getAccounts } from "@/lib/accounts";

/**
 * Two playlists side by side, one per service: which songs they share, which
 * each one is missing, and a way to send the missing ones over. Needs both
 * accounts connected.
 */
export default async function ComparePlaylistsPage() {
  const accounts = await getAccounts();
  const spotify = accounts.spotify;
  const youtube = accounts["youtube-music"];

  if (!spotify || !youtube) {
    redirect("/");
  }

  return (
    <AppShell accounts={accounts} title="Compare two playlists">
      <ComparePlaylists spotifyUserId={spotify.id} youtubeUserId={youtube.id} />
    </AppShell>
  );
}

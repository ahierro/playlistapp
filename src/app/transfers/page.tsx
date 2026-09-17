import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { TransfersView } from "@/components/transfers-view";
import { getAccounts } from "@/lib/accounts";

/** Playlist copies in both directions. Needs both accounts connected. */
export default async function TransfersPage() {
  const accounts = await getAccounts();
  const spotify = accounts.spotify;
  const youtube = accounts["youtube-music"];

  if (!spotify || !youtube) {
    redirect("/");
  }

  return (
    <AppShell accounts={accounts} title="Playlist copies">
      <TransfersView spotifyUserId={spotify.id} youtubeUserId={youtube.id} />
    </AppShell>
  );
}

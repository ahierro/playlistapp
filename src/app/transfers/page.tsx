import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { TransfersView } from "@/components/transfers-view";
import { getAccounts } from "@/lib/accounts";

/** Spotify -> YouTube Music copies. Needs both accounts connected. */
export default async function TransfersPage() {
  const accounts = await getAccounts();
  const spotify = accounts.spotify;
  const youtube = accounts["youtube-music"];

  if (!spotify || !youtube) {
    redirect("/");
  }

  return (
    <AppShell accounts={accounts} title="Copies to YouTube Music">
      <TransfersView spotifyUserId={spotify.id} youtubeUserId={youtube.id} />
    </AppShell>
  );
}

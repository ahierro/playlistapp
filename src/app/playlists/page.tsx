import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PlaylistsList } from "@/components/playlists-list";
import { getAccounts } from "@/lib/accounts";

/**
 * Session guard only. `PlaylistsList` owns the fetch, the localStorage cache and
 * the 403 (missing permission) case.
 */
export default async function PlaylistsPage() {
  const accounts = await getAccounts();
  const account = accounts["spotify"];

  if (!account) {
    redirect("/");
  }

  return (
    <AppShell accounts={accounts} title="Your Spotify playlists">
      <PlaylistsList
        userId={account.id}
        service="spotify"
        otherUserId={accounts["youtube-music"]?.id}
      />
    </AppShell>
  );
}

import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PlaylistsList } from "@/components/playlists-list";
import { getAccounts } from "@/lib/accounts";

/**
 * Session guard only. `PlaylistsList` owns the fetch, the localStorage cache and
 * the 403 (missing permission) case.
 */
export default async function YouTubeMusicPlaylistsPage() {
  const accounts = await getAccounts();
  const account = accounts["youtube-music"];

  if (!account) {
    redirect("/");
  }

  return (
    <AppShell accounts={accounts} title="Your YouTube Music playlists">
      <PlaylistsList userId={account.id} service="youtube-music" />
    </AppShell>
  );
}

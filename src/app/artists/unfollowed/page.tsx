import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { UnfollowedArtists } from "@/components/unfollowed-artists";
import { getAccounts } from "@/lib/accounts";

/**
 * Artists credited on the user's own songs that they do not follow yet. Spotify
 * only: YouTube has no equivalent of a per-track artist id.
 */
export default async function UnfollowedArtistsPage() {
  const accounts = await getAccounts();
  if (!accounts.spotify) redirect("/");

  return (
    <AppShell accounts={accounts} title="Artists you play but do not follow">
      <UnfollowedArtists userId={accounts.spotify.id} />
    </AppShell>
  );
}

import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { FollowedArtists } from "@/components/followed-artists";
import { getAccounts } from "@/lib/accounts";

/**
 * This page only guards the Spotify session. The list itself is fetched and
 * cached in localStorage by `FollowedArtists`, so navigating back here paints
 * from cache instead of paying a full pagination walk every time.
 */
export default async function ArtistsPage() {
  const accounts = await getAccounts();
  const account = accounts["spotify"];

  if (!account) {
    redirect("/");
  }

  return (
    <AppShell accounts={accounts} title="Artists you follow on Spotify">
      {/* Scoping the cache by user id keeps two accounts on the same browser apart. */}
      <FollowedArtists
        userId={account.id}
        service="spotify"
        otherUserId={accounts["youtube-music"]?.id}
      />
    </AppShell>
  );
}

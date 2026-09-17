import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { FollowedArtists } from "@/components/followed-artists";
import { getAccounts } from "@/lib/accounts";

/**
 * This page only guards the YouTube Music session. The list itself is fetched and
 * cached in localStorage by `FollowedArtists`, so navigating back here paints
 * from cache instead of paying a full pagination walk every time.
 */
export default async function YouTubeMusicArtistsPage() {
  const accounts = await getAccounts();
  const account = accounts["youtube-music"];

  if (!account) {
    redirect("/");
  }

  return (
    <AppShell accounts={accounts} title="Artists on YouTube Music">
      {/* Scoping the cache by user id keeps two accounts on the same browser apart. */}
      <FollowedArtists userId={account.id} service="youtube-music" />
    </AppShell>
  );
}

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { FollowedArtists } from "@/components/followed-artists";

/**
 * This page only guards the session. The list itself is fetched and cached in
 * localStorage by `FollowedArtists`, so navigating back here paints from cache
 * instead of paying a full pagination walk against Spotify every time.
 */
export default async function ArtistsPage() {
  const session = await auth();

  if (!session?.accessToken || session.error) {
    redirect("/");
  }

  return (
    <AppShell
      userName={session.user?.name}
      userImage={session.user?.image}
      title="Artists you follow"
    >
      {/* Scoping the cache by user id keeps two accounts on the same browser apart. */}
      <FollowedArtists userId={session.user?.id ?? "unknown-user"} />
    </AppShell>
  );
}

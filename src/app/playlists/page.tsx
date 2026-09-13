import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { PlaylistsList } from "@/components/playlists-list";

/**
 * Same as artists: session guard only. `PlaylistsList` owns the fetch, the
 * localStorage cache and the 403 (missing scope) case.
 */
export default async function PlaylistsPage() {
  const session = await auth();

  if (!session?.accessToken || session.error) {
    redirect("/");
  }

  return (
    <AppShell
      userName={session.user?.name}
      userImage={session.user?.image}
      title="Your playlists"
    >
      <PlaylistsList userId={session.user?.id ?? "unknown-user"} />
    </AppShell>
  );
}

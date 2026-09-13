import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { FollowedArtists } from "@/components/followed-artists";
import {
  getAllFollowedArtists,
  sortArtistsByName,
  SpotifyAuthError,
} from "@/lib/spotify";

/**
 * Fetches EVERY artist before rendering and sorts them alphabetically.
 * No pagination on the client: what you see is the complete list.
 * In the meantime the user sees `loading.tsx`.
 */
export default async function ArtistsPage() {
  const session = await auth();

  if (!session?.accessToken || session.error) {
    redirect("/");
  }

  let artists;
  try {
    artists = sortArtistsByName(
      await getAllFollowedArtists(session.accessToken),
    );
  } catch (error) {
    if (error instanceof SpotifyAuthError) {
      redirect("/");
    }
    throw error;
  }

  return (
    <AppShell
      userName={session.user?.name}
      userImage={session.user?.image}
      title="Artists you follow"
    >
      <FollowedArtists artists={artists} />
    </AppShell>
  );
}

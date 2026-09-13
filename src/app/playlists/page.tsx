import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { PlaylistsList } from "@/components/playlists-list";
import { ScopeError } from "@/components/scope-error";
import {
  getAllUserPlaylists,
  sortPlaylistsByName,
  SpotifyApiError,
  SpotifyAuthError,
  type SpotifyPlaylist,
} from "@/lib/spotify";

/** Same approach as artists: everything at once, sorted alphabetically. */
export default async function PlaylistsPage() {
  const session = await auth();

  if (!session?.accessToken || session.error) {
    redirect("/");
  }

  let playlists: SpotifyPlaylist[] | null = null;
  let scopeError: string | undefined;

  try {
    playlists = sortPlaylistsByName(
      await getAllUserPlaylists(session.accessToken),
    );
  } catch (error) {
    if (error instanceof SpotifyAuthError) {
      redirect("/");
    }
    // 403 = the session is missing `playlist-read-private`, because the token was
    // issued before the app requested that scope.
    if (error instanceof SpotifyApiError && error.status === 403) {
      scopeError = error.message;
    } else {
      throw error;
    }
  }

  return (
    <AppShell
      userName={session.user?.name}
      userImage={session.user?.image}
      title="Your playlists"
    >
      {playlists ? (
        <PlaylistsList playlists={playlists} />
      ) : (
        <ScopeError detail={scopeError} />
      )}
    </AppShell>
  );
}

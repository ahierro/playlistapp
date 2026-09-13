"use client";

import { useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";

import { CardGridSkeleton } from "@/components/card-grid-skeleton";
import { PlaylistExportDialog } from "@/components/playlist-export-dialog";
import { PlaylistCard } from "@/components/playlist-card";
import { ScopeError } from "@/components/scope-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatUpdatedAt } from "@/lib/client-cache";
import { sortPlaylistsByName, type SpotifyPlaylist } from "@/lib/spotify";
import { fetchAllUserPlaylists } from "@/lib/spotify-client";
import { useCachedList } from "@/lib/use-cached-list";
import { cn } from "@/lib/utils";

/** Same approach as artists: cache-first from localStorage, refresh on demand. */
export function PlaylistsList({ userId }: { userId: string }) {
  const [query, setQuery] = useState("");

  const {
    items,
    updatedAt,
    isLoading,
    isRefreshing,
    error,
    missingScope,
    refresh,
  } = useCachedList<SpotifyPlaylist>({
    cacheKey: "playlists",
    scope: userId,
    fetchAll: fetchAllUserPlaylists,
    sort: sortPlaylistsByName,
  });

  const playlists = useMemo(() => items ?? [], [items]);
  const busy = isLoading || isRefreshing;

  // Spotify only returns the contents of playlists the user owns or collaborates
  // on; the rest answer 403. The export dialog offers this narrower set first.
  const readablePlaylists = useMemo(
    () =>
      playlists.filter(
        (playlist) => playlist.owner.id === userId || playlist.collaborative,
      ),
    [playlists, userId],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return playlists;
    return playlists.filter(
      (playlist) =>
        playlist.name.toLowerCase().includes(term) ||
        playlist.owner.display_name?.toLowerCase().includes(term),
    );
  }, [playlists, query]);

  const updatedLabel = formatUpdatedAt(updatedAt);

  // 403 = the session is missing `playlist-read-private`, because the token was
  // issued before the app requested that scope. Signing in again is the only fix.
  if (missingScope !== null && !items) {
    return <ScopeError detail={missingScope} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          <p>
            {items
              ? `${playlists.length} playlists`
              : error
                ? "Could not load your playlists"
                : "Loading your playlists…"}
            {items && query ? ` · ${filtered.length} match` : null}
          </p>
          {updatedLabel && (
            <p className="text-xs opacity-70">
              {isRefreshing ? "Refreshing…" : `Cached · updated ${updatedLabel}`}
            </p>
          )}
        </div>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by name or owner"
              className="pl-9"
              aria-label="Filter playlists"
            />
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={refresh}
            disabled={busy}
            title="Discard the cache and fetch the list again from Spotify"
          >
            <RefreshCw className={cn(busy && "animate-spin")} />
            <span className="sr-only">Refresh from Spotify</span>
          </Button>

          <PlaylistExportDialog
            playlists={playlists}
            readablePlaylists={readablePlaylists}
          />
        </div>
      </div>

      {missingScope !== null && (
        <ScopeError detail={missingScope} />
      )}

      {error && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          {error}
        </p>
      )}

      {isLoading ? (
        <CardGridSkeleton />
      ) : !items ? null : filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          {playlists.length === 0
            ? "You do not have any playlists yet."
            : "No playlist matches the filter."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((playlist) => (
            <li key={playlist.id}>
              <PlaylistCard playlist={playlist} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

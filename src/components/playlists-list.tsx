"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { PlaylistCard } from "@/components/playlist-card";
import { Input } from "@/components/ui/input";
import type { SpotifyPlaylist } from "@/lib/spotify";

/** Same as artists: complete, sorted list from the server, filtering in memory. */
export function PlaylistsList({ playlists }: { playlists: SpotifyPlaylist[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return playlists;
    return playlists.filter(
      (playlist) =>
        playlist.name.toLowerCase().includes(term) ||
        playlist.owner.display_name?.toLowerCase().includes(term),
    );
  }, [playlists, query]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {playlists.length} playlists
          {query && ` · ${filtered.length} match`}
        </p>

        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by name or owner"
            className="pl-9"
            aria-label="Filter playlists"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
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

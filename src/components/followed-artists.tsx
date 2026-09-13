"use client";

import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";

import { ArtistCard } from "@/components/artist-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SpotifyArtist } from "@/lib/spotify";

/**
 * Receives the COMPLETE, already sorted list from the server. It does not paginate
 * or request anything: it only filters in memory, which is instant for a few thousand artists.
 */
export function FollowedArtists({ artists }: { artists: SpotifyArtist[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return artists;
    return artists.filter(
      (artist) =>
        artist.name.toLowerCase().includes(term) ||
        artist.genres?.some((genre) => genre.includes(term)),
    );
  }, [artists, query]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {artists.length} artists
          {query && ` · ${filtered.length} match`}
        </p>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by name or genre"
              className="pl-9"
              aria-label="Filter artists"
            />
          </div>

          <Button
            asChild
            variant="outline"
            size="icon"
            title="Download a .txt with every artist"
          >
            <a href="/api/spotify/following/export" download>
              <Download />
              <span className="sr-only">
                Download the complete list as .txt
              </span>
            </a>
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          {artists.length === 0
            ? "You do not follow any artists yet."
            : "No artist matches the filter."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((artist) => (
            <li key={artist.id}>
              <ArtistCard artist={artist} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

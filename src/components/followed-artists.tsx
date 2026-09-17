"use client";

import { useMemo, useState } from "react";
import { Download, RefreshCw, Search } from "lucide-react";

import { ArtistCard } from "@/components/artist-card";
import { CardGridSkeleton } from "@/components/card-grid-skeleton";
import { ScopeError } from "@/components/scope-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatUpdatedAt } from "@/lib/client-cache";
import type { ArtistSummary, MusicService } from "@/lib/music";
import { SERVICES } from "@/lib/services";
import { useCachedList } from "@/lib/use-cached-list";
import { cn } from "@/lib/utils";

/**
 * Owns the artist list end to end.
 *
 * The list is read from localStorage on mount, so coming back to this page paints
 * instantly and costs zero API requests. Only an empty cache or the refresh
 * button walks the pagination again. Filtering stays in memory, which is instant
 * for a few thousand artists.
 */
export function FollowedArtists({
  userId,
  service,
}: {
  userId: string;
  service: MusicService;
}) {
  const [query, setQuery] = useState("");
  const config = SERVICES[service];

  const {
    items,
    updatedAt,
    isLoading,
    isRefreshing,
    error,
    missingScope,
    refresh,
  } = useCachedList<ArtistSummary>({
    cacheKey: config.artists.cacheKey,
    scope: userId,
    fetchAll: config.artists.fetchAll,
    sort: config.artists.sort,
  });

  const artists = useMemo(() => items ?? [], [items]);
  const busy = isLoading || isRefreshing;

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return artists;
    return artists.filter(
      (artist) =>
        artist.name.toLowerCase().includes(term) ||
        artist.genres.some((genre) => genre.toLowerCase().includes(term)),
    );
  }, [artists, query]);

  const updatedLabel = formatUpdatedAt(updatedAt);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          <p>
            {items
              ? `${artists.length} artists`
              : error
                ? "Could not load your artists"
                : "Loading your artists…"}
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
              placeholder="Filter by name or genre"
              className="pl-9"
              aria-label="Filter artists"
            />
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={refresh}
            disabled={busy}
            title={`Discard the cache and fetch the list again from ${config.label}`}
          >
            <RefreshCw className={cn(busy && "animate-spin")} />
            <span className="sr-only">Refresh from {config.label}</span>
          </Button>

          <Button
            asChild
            variant="outline"
            size="icon"
            title="Download a .txt with every artist"
          >
            <a href={config.artists.exportUrl} download>
              <Download />
              <span className="sr-only">
                Download the complete list as .txt
              </span>
            </a>
          </Button>
        </div>
      </div>

      {missingScope !== null && (
        <ScopeError service={service} detail={missingScope} />
      )}

      {error && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          {error}
        </p>
      )}

      {isLoading ? (
        <CardGridSkeleton shape="circle" />
      ) : !items ? null : filtered.length === 0 ? (
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

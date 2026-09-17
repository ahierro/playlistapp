import Image from "next/image";
import { ExternalLink, Music2 } from "lucide-react";

import type { ArtistSummary } from "@/lib/music";

const formatter = new Intl.NumberFormat("en-US");

export function ArtistCard({ artist }: { artist: ArtistSummary }) {

  return (
    <a
      href={artist.url}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-full bg-muted">
        {artist.imageUrl ? (
          <Image
            src={artist.imageUrl}
            alt={artist.name}
            fill
            sizes="(max-width: 640px) 45vw, (max-width: 1024px) 22vw, 200px"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Music2 className="size-8" />
          </div>
        )}
      </div>

      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate font-semibold">
          <span className="truncate">{artist.name}</span>
          <ExternalLink className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </p>
        {/* Spotify dropped `followers` in February 2026 and YouTube never had it:
            if it is there we show it, otherwise we fall back to the genres. */}
        {artist.followers ? (
          <p className="truncate text-sm text-muted-foreground">
            {formatter.format(artist.followers)} followers
          </p>
        ) : null}
        {artist.genres.length > 0 ? (
          <p className="mt-1 truncate text-xs text-muted-foreground/80 capitalize">
            {artist.genres.slice(0, 2).join(" · ")}
          </p>
        ) : null}
      </div>
    </a>
  );
}

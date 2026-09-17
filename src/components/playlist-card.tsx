import Image from "next/image";
import { ExternalLink, ListMusic, Lock, Users2 } from "lucide-react";

import type { PlaylistSummary } from "@/lib/music";
import { cn } from "@/lib/utils";

const formatter = new Intl.NumberFormat("en-US");

export function PlaylistCard({
  playlist,
  selected,
  onSelectedChange,
}: {
  playlist: PlaylistSummary;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
}) {
  const total = playlist.trackCount;

  return (
    <div className="relative">
      <a
        href={playlist.url}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "group flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
          selected && "border-primary ring-2 ring-primary/25",
        )}
      >
        <div className="relative aspect-square w-full overflow-hidden rounded-md bg-muted">
          {playlist.imageUrl ? (
            <Image
              src={playlist.imageUrl}
              alt={playlist.name}
              fill
              sizes="(max-width: 640px) 45vw, (max-width: 1024px) 22vw, 200px"
              className="object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <ListMusic className="size-8" />
            </div>
          )}
        </div>

        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate font-semibold">
            <span className="truncate">{playlist.name}</span>
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </p>

          <p className="truncate text-sm text-muted-foreground">
            {total === null ? "—" : `${formatter.format(total)} tracks`}
            {playlist.ownerName && ` · ${playlist.ownerName}`}
          </p>

          <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground/80">
            {playlist.collaborative && (
              <span className="flex items-center gap-1">
                <Users2 className="size-3" />
                Collaborative
              </span>
            )}
            {playlist.isPublic === false && !playlist.collaborative && (
              <span className="flex items-center gap-1">
                <Lock className="size-3" />
                Private
              </span>
            )}
          </div>
        </div>
      </a>

      <label className="absolute top-6 right-6 z-10 flex size-8 cursor-pointer items-center justify-center rounded-md border bg-background/95 shadow-sm backdrop-blur-sm">
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelectedChange(event.target.checked)}
          className="size-4 accent-primary"
          aria-label={`Select ${playlist.name}`}
        />
      </label>
    </div>
  );
}

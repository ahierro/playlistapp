import Image from "next/image";
import { ExternalLink, ListMusic, Lock, Users2 } from "lucide-react";

import {
  pickPlaylistImage,
  playlistTrackCount,
  type SpotifyPlaylist,
} from "@/lib/spotify";

const formatter = new Intl.NumberFormat("en-US");

export function PlaylistCard({ playlist }: { playlist: SpotifyPlaylist }) {
  const image = pickPlaylistImage(playlist);
  const total = playlistTrackCount(playlist);

  return (
    <a
      href={playlist.external_urls.spotify}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-md bg-muted">
        {image ? (
          <Image
            src={image.url}
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
          {playlist.owner.display_name && ` · ${playlist.owner.display_name}`}
        </p>

        <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground/80">
          {playlist.collaborative && (
            <span className="flex items-center gap-1">
              <Users2 className="size-3" />
              Collaborative
            </span>
          )}
          {playlist.public === false && !playlist.collaborative && (
            <span className="flex items-center gap-1">
              <Lock className="size-3" />
              Private
            </span>
          )}
        </div>
      </div>
    </a>
  );
}

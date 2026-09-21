"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Check, ExternalLink, Loader2, Music2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCompleteArtists } from "@/lib/artist-pager";
import { formatUpdatedAt } from "@/lib/client-cache";
import { compareArtistLists } from "@/lib/artist-compare";
import { SERVICE_LABELS, type ArtistSummary, type MusicService } from "@/lib/music";
import { SERVICES } from "@/lib/services";
import { followArtistOnSpotify } from "@/lib/spotify-client";
import { cn } from "@/lib/utils";
import { subscribeToArtistOnYouTube } from "@/lib/youtube-client";

type FollowState =
  | { status: "idle" }
  | { status: "working" }
  | { status: "done"; name: string; url: string }
  | { status: "error"; message: string };

/**
 * Artists followed on one service but not on the other, with a button to
 * follow each one where they are missing.
 *
 * Both complete lists have to be downloaded first (the .txt button on each
 * artists page), because that is what leaves them in localStorage.
 */
export function CompareArtists({
  side,
  spotifyUserId,
  youtubeUserId,
}: {
  /** The service the artists are already followed on. */
  side: MusicService;
  spotifyUserId: string;
  youtubeUserId: string;
}) {
  const other: MusicService =
    side === "spotify" ? "youtube-music" : "spotify";
  const [query, setQuery] = useState("");
  const [states, setStates] = useState<Record<string, FollowState>>({});

  // localStorage is only readable after mount.
  const [lists, setLists] = useState<{
    spotify: { items: ArtistSummary[]; updatedAt: number } | null;
    "youtube-music": { items: ArtistSummary[]; updatedAt: number } | null;
  } | null>(null);

  useEffect(() => {
    setLists({
      spotify: getCompleteArtists("spotify", spotifyUserId),
      "youtube-music": getCompleteArtists("youtube-music", youtubeUserId),
    });
  }, [spotifyUserId, youtubeUserId]);

  const comparison = useMemo(() => {
    if (!lists?.spotify || !lists["youtube-music"]) return null;
    const { onlyInA, onlyInB, shared } = compareArtistLists(
      lists.spotify.items,
      lists["youtube-music"].items,
    );
    return {
      shared,
      missing: side === "spotify" ? onlyInA : onlyInB,
    };
  }, [lists, side]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const missing = comparison?.missing ?? [];
    if (!term) return missing;
    return missing.filter((artist) =>
      artist.name.toLowerCase().includes(term),
    );
  }, [comparison, query]);

  async function follow(artist: ArtistSummary) {
    setStates((current) => ({ ...current, [artist.id]: { status: "working" } }));
    try {
      const result =
        other === "spotify"
          ? await followArtistOnSpotify(artist.name)
          : await subscribeToArtistOnYouTube(artist.name);
      setStates((current) => ({
        ...current,
        [artist.id]: { status: "done", name: result.name, url: result.url },
      }));
    } catch (cause) {
      setStates((current) => ({
        ...current,
        [artist.id]: {
          status: "error",
          message:
            cause instanceof Error ? cause.message : "It could not be done",
        },
      }));
    }
  }

  if (lists === null) {
    return <p className="text-sm text-muted-foreground">Reading your lists…</p>;
  }

  const missingLists = (["spotify", "youtube-music"] as const).filter(
    (service) => !lists[service],
  );

  if (missingLists.length > 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-6">
        <p className="font-medium">The complete lists are not here yet.</p>
        <p className="text-sm text-muted-foreground">
          This page compares the two lists saved in this browser. Press the
          download button (↓) on each artists page once: it reads every page and
          keeps the full list.
        </p>
        <div className="flex flex-wrap gap-2">
          {missingLists.map((service) => (
            <Button key={service} asChild size="sm" variant="outline">
              <Link
                href={`${SERVICES[service].basePath}/artists`}
                className={SERVICES[service].themeClass}
              >
                Go to {SERVICE_LABELS[service]} artists
              </Link>
            </Button>
          ))}
        </div>
      </div>
    );
  }

  const sideUpdated = formatUpdatedAt(lists[side]?.updatedAt ?? null);
  const otherUpdated = formatUpdatedAt(lists[other]?.updatedAt ?? null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          <p>
            {comparison?.missing.length ?? 0} artists you follow on{" "}
            {SERVICE_LABELS[side]} but not on {SERVICE_LABELS[other]}
            {query ? ` · ${filtered.length} match` : ""}
          </p>
          <p className="text-xs opacity-70">
            {comparison?.shared ?? 0} followed on both · lists saved{" "}
            {sideUpdated} and {otherUpdated}
          </p>
        </div>

        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by name"
          aria-label="Filter artists"
          className="w-full sm:w-64"
        />
      </div>

      {other === "youtube-music" && (
        <p className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
          Following on YouTube spends one of the 100 searches a day YouTube
          allows, plus 50 units for the subscription, so roughly 100 artists a
          day.
        </p>
      )}

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          {comparison?.missing.length === 0
            ? `Every artist you follow on ${SERVICE_LABELS[side]} is also followed on ${SERVICE_LABELS[other]}.`
            : "No artist matches the filter."}
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {filtered.map((artist) => (
            <li key={artist.id}>
              <ArtistRow
                artist={artist}
                other={other}
                state={states[artist.id] ?? { status: "idle" }}
                onFollow={() => follow(artist)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ArtistRow({
  artist,
  other,
  state,
  onFollow,
}: {
  artist: ArtistSummary;
  other: MusicService;
  state: FollowState;
  onFollow: () => void;
}) {
  const OtherLogo = SERVICES[other].icon;

  return (
    <div className="flex flex-wrap items-center gap-3 p-3">
      <div className="relative size-10 shrink-0 overflow-hidden rounded-full bg-muted">
        {artist.imageUrl ? (
          <Image
            src={artist.imageUrl}
            alt=""
            fill
            sizes="40px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Music2 className="size-4" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <a
          href={artist.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 truncate font-medium hover:underline"
        >
          <span className="truncate">{artist.name}</span>
          <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
        </a>
        {state.status === "done" && (
          <p className="truncate text-xs text-muted-foreground">
            Followed as{" "}
            <a
              href={state.url}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {state.name}
            </a>
          </p>
        )}
        {state.status === "error" && (
          <p className="text-xs text-destructive">{state.message}</p>
        )}
        {artist.genres.length > 0 && state.status === "idle" && (
          <p className="truncate text-xs text-muted-foreground/80 capitalize">
            {artist.genres.slice(0, 2).join(" · ")}
          </p>
        )}
      </div>

      <div className={cn("shrink-0", SERVICES[other].themeClass)}>
        {state.status === "done" ? (
          <span className="flex items-center gap-1.5 text-sm text-primary">
            <Check className="size-4" />
            Followed
          </span>
        ) : (
          <Button
            size="sm"
            onClick={onFollow}
            disabled={state.status === "working"}
          >
            {state.status === "working" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <UserPlus />
            )}
            <OtherLogo className="size-4" />
            {state.status === "error" ? "Retry" : "Follow"}
          </Button>
        )}
      </div>
    </div>
  );
}

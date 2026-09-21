"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Loader2,
  Music2,
  RefreshCw,
  Search,
  UserPlus,
} from "lucide-react";

import { ScopeError } from "@/components/scope-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MissingScopeError, withRateLimit } from "@/lib/api-client";
import { getCompleteArtists, storeCompleteArtists } from "@/lib/artist-pager";
import { formatUpdatedAt, readCache, writeCache } from "@/lib/client-cache";
import { SERVICES } from "@/lib/services";
import { cn } from "@/lib/utils";
import {
  fetchAllFollowedArtists,
  fetchAllUserPlaylists,
  fetchPlaylistArtistRefs,
  fetchSavedTrackArtistRefs,
  followSpotifyArtistUri,
  type RefsProgress,
} from "@/lib/spotify-client";
import {
  tallyUnfollowedArtists,
  type SourcedCredit,
  type UnfollowedArtist,
} from "@/lib/unfollowed-artists";

const CACHE_KEY = "unfollowed-artists";
const LIKED_SONGS = "Liked songs";

type Scan = {
  artists: UnfollowedArtist[];
  /** Songs read, for the summary line. */
  sourcesRead: number;
  /** Set when the liked songs could not be read (missing permission). */
  libraryError: string | null;
  /**
   * When the list of artists you follow was taken from the copy saved in this
   * browser, the moment that copy was downloaded. Undefined when it was read
   * from Spotify during the scan.
   */
  followedSavedAt?: number;
};

type Progress = {
  /** The list being read right now. */
  label: string;
  /** Songs read across the whole scan. */
  done: number;
  /** Songs expected. 0 while the scan is still working out what to read. */
  total: number;
  /** Set while waiting out a Spotify rate limit. */
  waitingSeconds?: number;
};

type FollowState =
  | { status: "idle" }
  | { status: "working" }
  | { status: "done" }
  | { status: "error"; message: string };

/**
 * Artists credited on your playlists and liked songs that you do not follow.
 *
 * The scan reads every song of every playlist you own, so it is deliberately
 * manual: you press the button, and the result is kept in localStorage until
 * you ask for it again.
 */
export function UnfollowedArtists({ userId }: { userId: string }) {
  const [scan, setScan] = useState<Scan | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missingScope, setMissingScope] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [minTracks, setMinTracks] = useState("1");
  const [states, setStates] = useState<Record<string, FollowState>>({});
  const abortRef = useRef<AbortController | null>(null);

  // localStorage is only readable after mount.
  useEffect(() => {
    const cached = readCache<Scan>(CACHE_KEY, userId);
    if (cached) {
      setScan(cached.data);
      setUpdatedAt(cached.updatedAt);
    }
  }, [userId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function run() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    setError(null);
    setMissingScope(null);
    setStates({});

    // The bar counts SONGS, not lists: reading the liked songs alone can be
    // thousands of them, and a bar stuck at 0/80 says nothing.
    let label = "the artists you follow";
    let songsDone = 0;
    let listDone = 0;
    let songsTotal = 0;
    let waitingSeconds: number | undefined;

    const show = () =>
      setProgress({
        label,
        done: songsDone + listDone,
        total: songsTotal,
        waitingSeconds,
      });

    /** Runs a read, waiting out the pauses Spotify asks for. */
    const guarded = <T,>(task: () => Promise<T>) =>
      withRateLimit(task, {
        signal,
        onWait: (seconds) => {
          waitingSeconds = seconds;
          show();
        },
      }).finally(() => {
        waitingSeconds = undefined;
      });

    /**
     * Follows one list's pages. The first page carries the real length, which
     * replaces whatever the total was estimated at.
     */
    const track = (estimate: number) => {
      let counted: number | null = null;
      return ({ done, total }: RefsProgress) => {
        if (counted === null) {
          counted = total;
          songsTotal += total - estimate;
        }
        listDone = done;
        show();
      };
    };

    const finishList = () => {
      songsDone += listDone;
      listDone = 0;
    };

    show();

    try {
      // The .txt download leaves the complete list in localStorage, and the
      // comparison page reads it the same way. Reading it again from Spotify
      // would be dozens of requests for something already at hand.
      const saved = getCompleteArtists("spotify", userId);
      const followedSavedAt = saved?.updatedAt;
      const followed =
        saved?.items ?? (await guarded(() => fetchAllFollowedArtists({ signal })));
      const followedIds = followed.map((artist) => artist.id);

      // Keep what the scan had to fetch, so the artists page and the next scan
      // open with the full list too.
      if (!saved) storeCompleteArtists("spotify", userId, followed);

      label = "your playlists";
      show();
      const playlists = (await guarded(() => fetchAllUserPlaylists(signal))).filter(
        (playlist) => SERVICES.spotify.playlists.isReadable(playlist, userId),
      );

      // Spotify gives each playlist's length with the list itself, so the bar
      // has a total before a single song is read. Liked songs are added once
      // their first page reports how many there are.
      songsTotal = playlists.reduce(
        (sum, playlist) => sum + (playlist.trackCount ?? 0),
        0,
      );

      const credits: SourcedCredit[] = [];
      let libraryError: string | null = null;

      label = LIKED_SONGS;
      show();
      try {
        const refs = await guarded(() =>
          fetchSavedTrackArtistRefs({ signal, onProgress: track(0) }),
        );
        for (const artist of refs) {
          credits.push({ artist, source: LIKED_SONGS });
        }
        finishList();
      } catch (cause) {
        if (signal.aborted) return;
        // Without the library permission the playlists are still worth reading.
        if (cause instanceof MissingScopeError) {
          libraryError = cause.message || "Spotify refused to read your liked songs.";
          listDone = 0;
        } else {
          throw cause;
        }
      }

      for (const playlist of playlists) {
        if (signal.aborted) return;
        label = playlist.name;
        show();

        const estimate = playlist.trackCount ?? 0;
        try {
          const refs = await guarded(() =>
            fetchPlaylistArtistRefs(playlist.id, {
              signal,
              onProgress: track(estimate),
            }),
          );
          for (const artist of refs) {
            credits.push({ artist, source: playlist.name });
          }
          finishList();
        } catch (cause) {
          if (signal.aborted) return;
          // One playlist Spotify will not hand over does not sink the scan.
          if (!(cause instanceof MissingScopeError)) throw cause;
          // It was counted in the total but will never be read.
          songsTotal -= estimate - listDone;
          listDone = 0;
        }
      }

      if (signal.aborted) return;

      const result: Scan = {
        artists: tallyUnfollowedArtists(credits, followedIds),
        sourcesRead: playlists.length + (libraryError ? 0 : 1),
        libraryError,
        followedSavedAt,
      };
      const entry = writeCache(CACHE_KEY, userId, result);
      setScan(result);
      setUpdatedAt(entry.updatedAt);
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof MissingScopeError) {
        setMissingScope(cause.message || "");
      } else {
        setError(cause instanceof Error ? cause.message : "The scan failed");
      }
    } finally {
      if (abortRef.current === controller) {
        setProgress(null);
        abortRef.current = null;
      }
    }
  }

  async function follow(artist: UnfollowedArtist) {
    setStates((current) => ({ ...current, [artist.id]: { status: "working" } }));
    try {
      await followSpotifyArtistUri(artist.uri);
      setStates((current) => ({ ...current, [artist.id]: { status: "done" } }));
    } catch (cause) {
      setStates((current) => ({
        ...current,
        [artist.id]: {
          status: "error",
          message: cause instanceof Error ? cause.message : "It did not work",
        },
      }));
    }
  }

  const minimum = Number(minTracks);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (scan?.artists ?? []).filter(
      (artist) =>
        artist.trackCount >= minimum &&
        (!term || artist.name.toLowerCase().includes(term)),
    );
  }, [scan, query, minimum]);

  if (missingScope !== null) {
    return <ScopeError service="spotify" detail={missingScope} />;
  }

  const running = progress !== null;
  const percent = progress?.total
    ? Math.min(100, Math.round((progress.done / progress.total) * 100))
    : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-xl border bg-muted/25 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            <p>
              Every artist credited on your playlists and liked songs that you do
              not follow, the ones you have most songs of first.
            </p>
            {updatedAt && !running && (
              <>
                <p className="text-xs opacity-70">
                  Scanned {formatUpdatedAt(updatedAt)} · {scan?.sourcesRead ?? 0}{" "}
                  lists read
                </p>
                {scan?.followedSavedAt && (
                  <p className="text-xs opacity-70">
                    Compared against the artist list saved in this browser{" "}
                    {formatUpdatedAt(scan.followedSavedAt)}.{" "}
                    <Link href="/artists" className="underline">
                      Download it again
                    </Link>{" "}
                    to refresh it.
                  </p>
                )}
              </>
            )}
          </div>

          {running ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => abortRef.current?.abort()}
            >
              Cancel
            </Button>
          ) : (
            <Button size="sm" onClick={run}>
              <RefreshCw />
              {scan ? "Scan again" : "Scan my library"}
            </Button>
          )}
        </div>

        {progress && (
          <div className="flex flex-col gap-1.5" aria-live="polite">
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              // Until the lists are known there is no total to measure against,
              // so the bar says "working" rather than "nothing done yet".
              aria-valuemax={progress.total || undefined}
              aria-valuenow={progress.total ? progress.done : undefined}
            >
              <div
                className={cn(
                  "h-full rounded-full bg-primary",
                  progress.total
                    ? "transition-[width] duration-300"
                    : "animate-pulse opacity-40",
                )}
                style={{ width: progress.total ? `${percent}%` : "100%" }}
              />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {progress.total > 0 &&
                `${progress.done.toLocaleString("en-US")} / ${progress.total.toLocaleString("en-US")} songs · `}
              {progress.waitingSeconds
                ? `Spotify asked to slow down. Waiting ${progress.waitingSeconds} s…`
                : `Reading “${progress.label}”…`}
            </p>
          </div>
        )}

        {!scan && !running && (
          <p className="text-xs text-muted-foreground">
            The scan reads every song of every playlist you own, so it takes a
            while on a big library. The result is kept in this browser until you
            scan again.
          </p>
        )}
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          {error}
        </p>
      )}

      {scan?.libraryError && (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <p>
            Your liked songs were left out: this app now asks for permission to
            read them, and your session was created before that. Sign out of
            Spotify and sign in again, then scan once more.
          </p>
          <p className="text-xs opacity-70">{scan.libraryError}</p>
        </div>
      )}

      {scan && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {scan.artists.length} artists you do not follow
              {filtered.length !== scan.artists.length &&
                ` · ${filtered.length} shown`}
            </p>

            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Select value={minTracks} onValueChange={setMinTracks}>
                <SelectTrigger aria-label="Minimum songs" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Any number of songs</SelectItem>
                  <SelectItem value="2">2 songs or more</SelectItem>
                  <SelectItem value="3">3 songs or more</SelectItem>
                  <SelectItem value="5">5 songs or more</SelectItem>
                </SelectContent>
              </Select>

              <div className="relative flex-1 sm:w-56 sm:flex-none">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter by name"
                  aria-label="Filter artists"
                  className="pl-9"
                />
              </div>
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
              {scan.artists.length === 0
                ? "You already follow every artist in your library."
                : "No artist matches."}
            </p>
          ) : (
            <ul className="flex flex-col divide-y rounded-xl border">
              {filtered.map((artist) => (
                <li key={artist.id}>
                  <ArtistRow
                    artist={artist}
                    state={states[artist.id] ?? { status: "idle" }}
                    onFollow={() => follow(artist)}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {!scan && !running && (
        <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nothing scanned yet. You can also{" "}
          <Link href="/artists" className="underline">
            see the artists you already follow
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function ArtistRow({
  artist,
  state,
  onFollow,
}: {
  artist: UnfollowedArtist;
  state: FollowState;
  onFollow: () => void;
}) {
  const [top, ...rest] = artist.sources;
  const others = rest.reduce((sum, source) => sum + source.count, 0);

  return (
    <div className="flex flex-wrap items-center gap-3 p-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Music2 className="size-4" />
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
        <p className="truncate text-xs text-muted-foreground">
          {artist.trackCount} song{artist.trackCount === 1 ? "" : "s"}
          {top && ` · ${top.name}`}
          {others > 0 &&
            ` and ${rest.length} other list${rest.length === 1 ? "" : "s"}`}
        </p>
        {state.status === "error" && (
          <p className="text-xs text-destructive">{state.message}</p>
        )}
      </div>

      <div className="shrink-0">
        {state.status === "done" ? (
          <span className="flex items-center gap-1.5 text-sm text-primary">
            <Check className="size-4" />
            Followed
          </span>
        ) : (
          <Button size="sm" onClick={onFollow} disabled={state.status === "working"}>
            {state.status === "working" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <UserPlus />
            )}
            {state.status === "error" ? "Retry" : "Follow"}
          </Button>
        )}
      </div>
    </div>
  );
}

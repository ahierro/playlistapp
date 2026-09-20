"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  Copy,
  ExternalLink,
  HelpCircle,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  SERVICE_LABELS,
  type ExportedTrack,
  type MusicService,
  type PlaylistSummary,
} from "@/lib/music";
import { cleanExportedTrack, SERVICES } from "@/lib/services";
import {
  compareTrackLists,
  type TrackComparison,
} from "@/lib/track-compare";
import {
  enqueueTrackTransfer,
  estimateUnits,
  initTransfers,
} from "@/lib/transfer-store";
import { useCachedList } from "@/lib/use-cached-list";
import { cn } from "@/lib/utils";

/** YouTube's "Liked videos" is readable but the API refuses to write to it. */
const YOUTUBE_LIKES_ID = "LL";

const SIDES: MusicService[] = ["spotify", "youtube-music"];

/** A track plus a stable identity, so the checkboxes survive a re-render. */
type Song = ExportedTrack & { uid: string };

function toSongs(tracks: ExportedTrack[], side: MusicService): Song[] {
  return tracks.map((track, index) => ({
    ...cleanExportedTrack(track),
    uid: `${side}:${index}`,
  }));
}

/** Drops the fields that only exist for this page before queueing a copy. */
function toExportedTrack(song: Song): ExportedTrack {
  return {
    name: song.name,
    artists: song.artists,
    album: song.album,
    type: song.type,
    durationMs: song.durationMs,
  };
}

type Loaded = {
  spotify: { playlist: PlaylistSummary; songs: Song[] };
  "youtube-music": { playlist: PlaylistSummary; songs: Song[] };
  comparison: TrackComparison<Song>;
};

/**
 * Two playlists side by side: what they have in common, and what each one is
 * missing, with the missing songs ready to be copied over.
 */
export function ComparePlaylists({
  spotifyUserId,
  youtubeUserId,
}: {
  spotifyUserId: string;
  youtubeUserId: string;
}) {
  const [chosen, setChosen] = useState<Record<MusicService, string>>({
    spotify: "",
    "youtube-music": "",
  });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reading, setReading] = useState<MusicService | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Reading a YouTube playlist costs quota, so a playlist is read once per visit.
  const trackCache = useRef(new Map<string, ExportedTrack[]>());

  const spotifyList = useCachedList<PlaylistSummary>({
    cacheKey: SERVICES.spotify.playlists.cacheKey,
    scope: spotifyUserId,
    fetchAll: SERVICES.spotify.playlists.fetchAll,
    sort: SERVICES.spotify.playlists.sort,
  });
  const youtubeList = useCachedList<PlaylistSummary>({
    cacheKey: SERVICES["youtube-music"].playlists.cacheKey,
    scope: youtubeUserId,
    fetchAll: SERVICES["youtube-music"].playlists.fetchAll,
    sort: SERVICES["youtube-music"].playlists.sort,
  });

  const lists: Record<MusicService, PlaylistSummary[]> = useMemo(
    () => ({
      spotify: (spotifyList.items ?? []).filter((playlist) =>
        SERVICES.spotify.playlists.isReadable(playlist, spotifyUserId),
      ),
      "youtube-music": (youtubeList.items ?? []).filter(
        (playlist) => playlist.isMusic !== false,
      ),
    }),
    [spotifyList.items, youtubeList.items, spotifyUserId],
  );

  const picked = {
    spotify: lists.spotify.find((playlist) => playlist.id === chosen.spotify),
    "youtube-music": lists["youtube-music"].find(
      (playlist) => playlist.id === chosen["youtube-music"],
    ),
  };
  const ready = Boolean(picked.spotify && picked["youtube-music"]);
  const busy = reading !== null;

  async function compare() {
    if (!picked.spotify || !picked["youtube-music"]) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setLoaded(null);

    try {
      const songs = {} as Record<MusicService, Song[]>;

      for (const side of SIDES) {
        const playlist = picked[side]!;
        setReading(side);
        const key = `${side}:${playlist.id}`;
        let tracks = trackCache.current.get(key);
        if (!tracks) {
          tracks = await SERVICES[side].playlists.fetchTracks(
            playlist.id,
            controller.signal,
          );
          trackCache.current.set(key, tracks);
        }
        songs[side] = toSongs(tracks, side);
      }

      setLoaded({
        spotify: { playlist: picked.spotify, songs: songs.spotify },
        "youtube-music": {
          playlist: picked["youtube-music"],
          songs: songs["youtube-music"],
        },
        comparison: compareTrackLists(songs.spotify, songs["youtube-music"]),
      });
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "The playlists could not be read");
    } finally {
      // A newer comparison may have taken over: leave its state alone.
      if (abortRef.current === controller) {
        setReading(null);
        abortRef.current = null;
      }
    }
  }

  const listError = spotifyList.error ?? youtubeList.error;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 rounded-xl border bg-muted/25 p-4 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
        {SIDES.map((side, position) => (
          <div key={side} className={cn("contents", SERVICES[side].themeClass)}>
            {position === 1 && (
              <div className="hidden justify-center pb-2 text-muted-foreground sm:flex">
                <ArrowLeftRight className="size-4" />
              </div>
            )}
            <PlaylistPicker
              side={side}
              playlists={lists[side]}
              value={chosen[side]}
              loading={
                side === "spotify" ? spotifyList.isLoading : youtubeList.isLoading
              }
              disabled={busy}
              onChange={(id) =>
                setChosen((current) => ({ ...current, [side]: id }))
              }
            />
          </div>
        ))}

        <div className="sm:col-span-3 sm:justify-self-end">
          <Button onClick={compare} disabled={!ready || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <ArrowLeftRight />}
            {busy
              ? `Reading the ${SERVICE_LABELS[reading!]} playlist…`
              : "Compare"}
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Reading a YouTube Music playlist costs about 2 quota units per 50 songs,
        so comparing is cheap. Each playlist is read once per visit.
      </p>

      {(listError || error) && (
        <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          {error ?? listError}
        </p>
      )}

      {loaded && (
        <Results
          loaded={loaded}
          spotifyUserId={spotifyUserId}
          youtubeUserId={youtubeUserId}
        />
      )}
    </div>
  );
}

function PlaylistPicker({
  side,
  playlists,
  value,
  loading,
  disabled,
  onChange,
}: {
  side: MusicService;
  playlists: PlaylistSummary[];
  value: string;
  loading: boolean;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const Logo = SERVICES[side].icon;

  const options: ComboboxOption[] = playlists.map((playlist) => ({
    value: playlist.id,
    label: playlist.name,
    hint: playlist.trackCount === null ? undefined : `${playlist.trackCount}`,
    keywords: playlist.ownerName ?? undefined,
  }));

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <Logo className="size-4" />
        {SERVICE_LABELS[side]}
      </span>
      <Combobox
        options={options}
        value={value}
        onValueChange={onChange}
        disabled={disabled || loading}
        aria-label={`${SERVICE_LABELS[side]} playlist`}
        placeholder={
          loading
            ? "Loading your playlists…"
            : playlists.length === 0
              ? "No playlist to compare"
              : "Choose a playlist"
        }
        searchPlaceholder="Type to filter by name or owner"
        emptyMessage="No playlist matches"
        contentClassName={SERVICES[side].themeClass}
      />
    </div>
  );
}

function Results({
  loaded,
  spotifyUserId,
  youtubeUserId,
}: {
  loaded: Loaded;
  spotifyUserId: string;
  youtubeUserId: string;
}) {
  const { comparison } = loaded;
  const loose = comparison.matched.filter(
    (pair) => pair.reason === "contained",
  ).length;
  const total =
    comparison.matched.length +
    comparison.possible.length +
    comparison.onlyInA.length +
    comparison.onlyInB.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="In both playlists"
          value={comparison.matched.length}
          of={total}
          tone="ok"
        />
        <Stat
          label={`Missing on ${SERVICE_LABELS["youtube-music"]}`}
          value={comparison.onlyInA.length}
          of={total}
        />
        <Stat
          label={`Missing on ${SERVICE_LABELS.spotify}`}
          value={comparison.onlyInB.length}
          of={total}
        />
      </div>

      <MissingSection
        from="spotify"
        loaded={loaded}
        songs={comparison.onlyInA}
        spotifyUserId={spotifyUserId}
        youtubeUserId={youtubeUserId}
      />
      <MissingSection
        from="youtube-music"
        loaded={loaded}
        songs={comparison.onlyInB}
        spotifyUserId={spotifyUserId}
        youtubeUserId={youtubeUserId}
      />

      {comparison.possible.length > 0 && (
        <details className="rounded-xl border p-4">
          <summary className="flex cursor-pointer items-center gap-2 font-medium select-none">
            <HelpCircle className="size-4 text-amber-500" />
            {comparison.possible.length} possible match
            {comparison.possible.length === 1 ? "" : "es"}
          </summary>
          <p className="mt-2 text-sm text-muted-foreground">
            Same title, different artist, and neither one&apos;s words fully
            cover the other&apos;s. Usually a cover, a live version, or a
            YouTube title the parser read wrong. They are counted as present on
            both sides and are not offered for copying.
          </p>
          <ul className="mt-3 flex flex-col divide-y rounded-lg border">
            {comparison.possible.map((pair) => (
              <li
                key={pair.a.uid}
                className="grid gap-1 p-3 text-sm sm:grid-cols-2 sm:gap-4"
              >
                <TrackLine song={pair.a} side="spotify" />
                <TrackLine song={pair.b} side="youtube-music" />
              </li>
            ))}
          </ul>
        </details>
      )}

      {comparison.matched.length > 0 && (
        <details className="rounded-xl border p-4">
          <summary className="flex cursor-pointer items-center gap-2 font-medium select-none">
            <Check className="size-4 text-primary" />
            {comparison.matched.length} song
            {comparison.matched.length === 1 ? "" : "s"} in both
            {loose > 0 && (
              <span className="text-sm font-normal text-muted-foreground">
                · {loose} matched by words
              </span>
            )}
          </summary>
          <ul className="mt-3 flex flex-col divide-y rounded-lg border">
            {comparison.matched.map((pair) => (
              <li key={pair.a.uid} className="p-3 text-sm">
                <TrackLine song={pair.a} side="spotify" />
                {/* A loose pairing is worth showing whole: the two titles can
                    look very different even when the song is the same. */}
                {pair.reason === "contained" && (
                  <div className="mt-1 border-l-2 pl-2 text-xs opacity-80">
                    <TrackLine song={pair.b} side="youtube-music" />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  of,
  tone,
}: {
  label: string;
  value: number;
  of: number;
  tone?: "ok";
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className={cn("text-2xl font-bold", tone === "ok" && "text-primary")}>
        {value}
      </p>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-xs text-muted-foreground/70">
        of {of} distinct song{of === 1 ? "" : "s"}
      </p>
    </div>
  );
}

function TrackLine({ song, side }: { song: Song; side: MusicService }) {
  const Logo = SERVICES[side].icon;

  return (
    <p className="flex min-w-0 items-baseline gap-1.5">
      <Logo className="size-3 shrink-0 translate-y-0.5 text-muted-foreground" />
      <span className="min-w-0 truncate">
        <span className="text-muted-foreground">
          {song.artists.join(", ") || "Unknown artist"}
        </span>
        {" — "}
        {song.name}
      </span>
    </p>
  );
}

/**
 * The songs one playlist has and the other does not, with a checkbox each and
 * a button that queues the ticked ones as a copy into the other playlist.
 */
function MissingSection({
  from,
  loaded,
  songs,
  spotifyUserId,
  youtubeUserId,
}: {
  from: MusicService;
  loaded: Loaded;
  songs: Song[];
  spotifyUserId: string;
  youtubeUserId: string;
}) {
  const router = useRouter();
  const to: MusicService = from === "spotify" ? "youtube-music" : "spotify";
  const source = loaded[from].playlist;
  const target = loaded[to].playlist;

  // Episodes are not songs and the copy skips them anyway.
  const copyable = useMemo(
    () => songs.filter((song) => song.type !== "episode"),
    [songs],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const chosen = copyable.filter((song) => selected.has(song.uid));

  const writable =
    to === "youtube-music"
      ? target.id !== YOUTUBE_LIKES_ID
      : target.ownerId === spotifyUserId || target.collaborative;

  const units = estimateUnits(
    from === "spotify" ? "spotify-to-youtube" : "youtube-to-spotify",
    chosen.length,
    0,
  );

  function copy() {
    if (chosen.length === 0 || !writable) return;

    initTransfers(spotifyUserId, youtubeUserId);
    enqueueTrackTransfer(
      from === "spotify" ? "spotify-to-youtube" : "youtube-to-spotify",
      { id: source.id, name: source.name, url: source.url },
      chosen.map(toExportedTrack),
      { mode: "existing", playlistId: target.id, title: target.name },
    );
    router.push("/transfers");
  }

  if (songs.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        Everything in “{source.name}” is already in “{target.name}” on{" "}
        {SERVICE_LABELS[to]}.
      </p>
    );
  }

  const FromLogo = SERVICES[from].icon;
  const ToLogo = SERVICES[to].icon;

  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-4",
        SERVICES[to].themeClass,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 font-semibold">
            <FromLogo className="size-4" />
            {songs.length} only on {SERVICE_LABELS[from]}
          </h2>
          <p className="text-xs text-muted-foreground">
            In “{source.name}” but not in “{target.name}”
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setSelected(new Set(copyable.map((song) => song.uid)))
            }
            disabled={chosen.length === copyable.length}
          >
            Select all
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelected(new Set())}
            disabled={chosen.length === 0}
          >
            Deselect all
          </Button>
          <Button
            size="sm"
            onClick={copy}
            disabled={chosen.length === 0 || !writable}
            title={
              writable
                ? `Queue ${chosen.length} songs as a copy into “${target.name}”`
                : `This app cannot add songs to “${target.name}”`
            }
          >
            <Copy />
            <ToLogo className="size-4" />
            Copy {chosen.length > 0 ? chosen.length : ""} to “{target.name}”
          </Button>
        </div>
      </header>

      {!writable && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          {to === "youtube-music"
            ? "YouTube does not let this app add songs to “Liked videos”. Pick another playlist."
            : "You do not own this Spotify playlist and it is not collaborative, so nothing can be added to it."}
        </p>
      )}

      {chosen.length > 0 && to === "youtube-music" && (
        <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          Copying {chosen.length} song{chosen.length === 1 ? "" : "s"} to
          YouTube Music needs up to{" "}
          <strong className="text-foreground">
            {units.toLocaleString("en-US")}
          </strong>{" "}
          quota units (about 150 each). Above the daily 10,000 the copy pauses
          and you continue it the next day from the Copies page.
        </p>
      )}

      <ul className="flex max-h-96 flex-col divide-y overflow-y-auto rounded-lg border">
        {songs.map((song) => {
          const isEpisode = song.type === "episode";

          return (
            <li key={song.uid} className="flex items-start gap-3 p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 accent-primary"
                checked={selected.has(song.uid)}
                disabled={isEpisode}
                aria-label={`Copy ${song.name}`}
                onChange={(event) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(song.uid);
                    else next.delete(song.uid);
                    return next;
                  })
                }
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {song.artists.join(", ") || "Unknown artist"} — {song.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {isEpisode ? "Podcast episode · not copied" : song.album ?? ""}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <a
        href={source.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 self-start text-xs text-muted-foreground underline"
      >
        Open “{source.name}” on {SERVICE_LABELS[from]}
        <ExternalLink className="size-3" />
      </a>
    </section>
  );
}

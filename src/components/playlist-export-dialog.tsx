"use client";

import { useRef, useState } from "react";
import { FileJson, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  buildPlaylistExport,
  downloadJson,
  type ExportProgress,
} from "@/lib/playlist-export";
import type { SpotifyPlaylist } from "@/lib/spotify";

type Scope = "readable" | "all";

const formatter = new Intl.NumberFormat("en-US");

/**
 * Downloads a JSON with every playlist and its tracks (artist, album, song).
 *
 * The work happens in the browser, one playlist at a time, so the dialog can show
 * real progress and the user can cancel. Doing it in a single server request would
 * mean one function call fetching thousands of tracks with no feedback.
 */
export function PlaylistExportDialog({
  playlists,
  readablePlaylists,
}: {
  playlists: SpotifyPlaylist[];
  /**
   * The ones Spotify will actually hand over: owned by the user or collaborative.
   * Since February 2026 every other playlist answers 403 on its contents.
   */
  readablePlaylists: SpotifyPlaylist[];
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("readable");
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const selected = scope === "all" ? playlists : readablePlaylists;
  const running = progress !== null;
  const blocked = playlists.length - readablePlaylists.length;

  const options: {
    value: Scope;
    label: string;
    hint: string;
    count: number;
  }[] = [
    {
      value: "readable",
      label: "The ones with readable tracks",
      hint: "Yours and the collaborative ones",
      count: readablePlaylists.length,
    },
    {
      value: "all",
      label: "Every playlist on this page",
      hint: `includes ${formatter.format(blocked)} that will come out with no tracks`,
      count: playlists.length,
    },
  ];

  function cancel() {
    abortRef.current?.abort();
  }

  function close(next: boolean) {
    // Closing mid-export cancels it rather than leaving requests running.
    if (!next && running) cancel();
    setOpen(next);
  }

  async function start() {
    const controller = new AbortController();
    abortRef.current = controller;

    setError(null);
    setProgress({
      done: 0,
      total: selected.length,
      current: "",
      unreadable: 0,
    });

    try {
      const data = await buildPlaylistExport(selected, {
        signal: controller.signal,
        onProgress: setProgress,
      });

      const date = new Date().toISOString().slice(0, 10);
      downloadJson(data, `playlists-${date}.json`);

      setProgress(null);
      setOpen(false);
    } catch (cause) {
      setProgress(null);

      // Cancelling is not a failure, so it gets no error message.
      if (controller.signal.aborted) return;

      setError(cause instanceof Error ? cause.message : "The export failed");
    }
  }

  const percent = progress?.total
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          disabled={playlists.length === 0}
          title="Download a JSON with every playlist and its tracks"
        >
          <FileJson />
          <span className="sr-only">Export playlists as JSON</span>
        </Button>
      </DialogTrigger>

      <DialogContent showCloseButton={!running}>
        <div className="flex flex-col gap-1.5">
          <DialogTitle>Export playlists as JSON</DialogTitle>
          <DialogDescription>
            One entry per playlist, with the artist, album and song of every
            track.
          </DialogDescription>
        </div>

        {running ? (
          <div className="flex flex-col gap-3">
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>

            <p className="text-sm text-muted-foreground" aria-live="polite">
              {progress.done} / {progress.total} playlists
              {progress.unreadable > 0 &&
                ` · ${progress.unreadable} unreadable`}
              {progress.current && (
                <span className="block truncate text-xs opacity-70">
                  Reading “{progress.current}”…
                </span>
              )}
            </p>
          </div>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Which playlists to export</legend>

              {options.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-checked:border-primary has-checked:bg-accent has-disabled:cursor-not-allowed has-disabled:opacity-50"
                >
                  <input
                    type="radio"
                    name="export-scope"
                    value={option.value}
                    checked={scope === option.value}
                    disabled={option.count === 0}
                    onChange={() => setScope(option.value)}
                    className="mt-1 accent-primary"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {option.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatter.format(option.count)} playlists ·{" "}
                      {option.hint}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            {blocked > 0 && (
              <p className="flex gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Since February 2026 Spotify only returns the contents of
                  playlists you own or collaborate on. For the other{" "}
                  {formatter.format(blocked)} it answers 403, so they can only be
                  exported as names.
                </span>
              </p>
            )}
          </>
        )}

        {error && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          {running ? (
            <Button variant="outline" onClick={cancel}>
              Cancel
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => close(false)}>
                Close
              </Button>
              <Button onClick={start} disabled={selected.length === 0}>
                Export {formatter.format(selected.length)}
              </Button>
            </>
          )}
        </div>

        {running && (
          <p className="text-xs text-muted-foreground">
            Keep this tab open. Big libraries take a while: it reads one playlist
            at a time to stay under Spotify&rsquo;s rate limit.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

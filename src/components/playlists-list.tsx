"use client";

import { useMemo, useRef, useState } from "react";
import { Copy, FileJson, RefreshCw, Search } from "lucide-react";

import { CardGridSkeleton } from "@/components/card-grid-skeleton";
import { CopyPlaylistsDialog } from "@/components/copy-playlists-dialog";
import { PlaylistCard } from "@/components/playlist-card";
import { ScopeError } from "@/components/scope-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatUpdatedAt } from "@/lib/client-cache";
import {
  buildPlaylistExport,
  downloadJson,
  type ExportProgress,
} from "@/lib/playlist-export";
import type { MusicService, PlaylistSummary } from "@/lib/music";
import { SERVICES } from "@/lib/services";
import { useCachedList } from "@/lib/use-cached-list";
import { cn } from "@/lib/utils";

type PlaylistSelection =
  | { mode: "all" }
  | { mode: "custom"; ids: Set<string> };

/** Same approach as artists: cache-first from localStorage, refresh on demand. */
export function PlaylistsList({
  userId,
  service,
  otherUserId,
}: {
  userId: string;
  service: MusicService;
  /**
   * The account on the other service, when it is connected too. Enables
   * copying the selected playlists there.
   */
  otherUserId?: string;
}) {
  const config = SERVICES[service];
  const [copyOpen, setCopyOpen] = useState(false);
  const copyTarget: MusicService =
    service === "spotify" ? "youtube-music" : "spotify";
  const [query, setQuery] = useState("");
  // Nothing selected until the user picks: no accidental export or copy of everything.
  const [selection, setSelection] = useState<PlaylistSelection>({
    mode: "custom",
    ids: new Set(),
  });
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(
    null,
  );
  const [exportError, setExportError] = useState<string | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  const {
    items,
    updatedAt,
    isLoading,
    isRefreshing,
    error,
    missingScope,
    refresh,
  } = useCachedList<PlaylistSummary>({
    cacheKey: config.playlists.cacheKey,
    scope: userId,
    fetchAll: config.playlists.fetchAll,
    sort: config.playlists.sort,
  });

  // Playlists whose tracks the service will not expose are useless here (for
  // Spotify, anything the user neither owns nor collaborates on).
  // YouTube mixes plain-video playlists in with the YouTube Music ones.
  const [musicOnly, setMusicOnly] = useState(true);
  const canFilterMusic = service === "youtube-music";

  const { isReadable } = config.playlists;
  const readable = useMemo(
    () => (items ?? []).filter((playlist) => isReadable(playlist, userId)),
    [items, userId, isReadable],
  );
  const playlists = useMemo(
    () =>
      canFilterMusic && musicOnly
        ? readable.filter((playlist) => playlist.isMusic !== false)
        : readable,
    [readable, canFilterMusic, musicOnly],
  );
  const hiddenCount = readable.length - playlists.length;
  const busy = isLoading || isRefreshing;

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return playlists;
    return playlists.filter(
      (playlist) =>
        playlist.name.toLowerCase().includes(term) ||
        playlist.ownerName?.toLowerCase().includes(term),
    );
  }, [playlists, query]);

  const selectedPlaylists = useMemo(
    () =>
      selection.mode === "all"
        ? playlists
        : playlists.filter((playlist) => selection.ids.has(playlist.id)),
    [playlists, selection],
  );

  const updatedLabel = formatUpdatedAt(updatedAt);
  const exportRunning = exportProgress !== null;
  const allSelected =
    playlists.length > 0 && selectedPlaylists.length === playlists.length;

  function changeSelection(playlistId: string, selected: boolean) {
    setSelection((current) => {
      const ids =
        current.mode === "all"
          ? new Set(playlists.map((playlist) => playlist.id))
          : new Set(current.ids);

      if (selected) ids.add(playlistId);
      else ids.delete(playlistId);

      return ids.size === playlists.length
        ? { mode: "all" }
        : { mode: "custom", ids };
    });
  }

  async function exportSelected() {
    if (selectedPlaylists.length === 0) return;

    const controller = new AbortController();
    exportAbortRef.current = controller;
    setExportError(null);
    setExportProgress({
      done: 0,
      total: selectedPlaylists.length,
      current: "",
      unreadable: 0,
    });

    try {
      const data = await buildPlaylistExport(selectedPlaylists, {
        service,
        fetchTracks: config.playlists.fetchTracks,
        signal: controller.signal,
        onProgress: setExportProgress,
      });
      const date = new Date().toISOString().slice(0, 10);
      downloadJson(data, `${config.playlists.exportFilePrefix}-${date}.json`);
      setExportProgress(null);
    } catch (cause) {
      setExportProgress(null);
      if (controller.signal.aborted) return;
      setExportError(
        cause instanceof Error ? cause.message : "The export failed",
      );
    } finally {
      exportAbortRef.current = null;
    }
  }

  const exportPercent = exportProgress?.total
    ? Math.round((exportProgress.done / exportProgress.total) * 100)
    : 0;

  // 403 = the session is missing a permission (a scope added after the token was
  // issued, or one the user unticked on the consent screen). Signing in again fixes it.
  if (missingScope !== null && !items) {
    return <ScopeError service={service} detail={missingScope} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          <p>
            {items
              ? `${playlists.length} playlists`
              : error
                ? "Could not load your playlists"
                : "Loading your playlists…"}
            {items && query ? ` · ${filtered.length} match` : null}
          </p>
          {canFilterMusic && items && (
            <label className="mt-1 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={musicOnly}
                onChange={(event) => {
                  setMusicOnly(event.target.checked);
                  setSelection({ mode: "custom", ids: new Set() });
                }}
                disabled={exportRunning}
                className="accent-primary"
              />
              Only music playlists
              {musicOnly && hiddenCount > 0 && (
                <span className="opacity-70">
                  ({hiddenCount} video playlist{hiddenCount === 1 ? "" : "s"} hidden)
                </span>
              )}
            </label>
          )}
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
              placeholder="Filter by name or owner"
              className="pl-9"
              aria-label="Filter playlists"
            />
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={refresh}
            disabled={busy || exportRunning}
            title={`Discard the cache and fetch the list again from ${config.label}`}
          >
            <RefreshCw className={cn(busy && "animate-spin")} />
            <span className="sr-only">Refresh from {config.label}</span>
          </Button>
        </div>
      </div>

      {items && playlists.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border bg-muted/25 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {selectedPlaylists.length} of {playlists.length} selected
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelection({ mode: "all" })}
                disabled={allSelected || exportRunning}
              >
                Select all
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSelection({ mode: "custom", ids: new Set() })
                }
                disabled={selectedPlaylists.length === 0 || exportRunning}
              >
                Deselect all
              </Button>

              {exportRunning ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportAbortRef.current?.abort()}
                >
                  Cancel download
                </Button>
              ) : (
                <>
                  {otherUserId && (
                    <Button
                      size="sm"
                      variant="outline"
                      className={cn(
                        SERVICES[copyTarget].themeClass,
                        "hover:border-primary/60",
                      )}
                      onClick={() => setCopyOpen(true)}
                      disabled={selectedPlaylists.length === 0 || busy}
                    >
                      <Copy />
                      Copy to {SERVICES[copyTarget].label}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={exportSelected}
                    disabled={selectedPlaylists.length === 0 || busy}
                  >
                    <FileJson />
                    Download JSON data
                  </Button>
                </>
              )}
            </div>
          </div>

          {exportProgress && (
            <div className="flex flex-col gap-1.5" aria-live="polite">
              <div
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={exportProgress.total}
                aria-valuenow={exportProgress.done}
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${exportPercent}%` }}
                />
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {exportProgress.done} / {exportProgress.total} playlists
                {exportProgress.current &&
                  ` · Reading “${exportProgress.current}”…`}
              </p>
            </div>
          )}
        </div>
      )}

      {otherUserId && (
        <CopyPlaylistsDialog
          direction={
            service === "spotify" ? "spotify-to-youtube" : "youtube-to-spotify"
          }
          open={copyOpen}
          onOpenChange={setCopyOpen}
          playlists={selectedPlaylists}
          spotifyUserId={service === "spotify" ? userId : otherUserId}
          youtubeUserId={service === "spotify" ? otherUserId : userId}
        />
      )}

      {missingScope !== null && (
        <ScopeError service={service} detail={missingScope} />
      )}

      {error && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          {error}
        </p>
      )}

      {exportError && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          {exportError}
        </p>
      )}

      {isLoading ? (
        <CardGridSkeleton />
      ) : !items ? null : filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          {playlists.length === 0
            ? "You do not have any playlists yet."
            : "No playlist matches the filter."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((playlist) => (
            <li key={playlist.id}>
              <PlaylistCard
                playlist={playlist}
                selected={
                  selection.mode === "all" || selection.ids.has(playlist.id)
                }
                onSelectedChange={(selected) =>
                  changeSelection(playlist.id, selected)
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

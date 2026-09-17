"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeftRight, Download, Loader2, RefreshCw, Search } from "lucide-react";

import { ArtistCard } from "@/components/artist-card";
import { CardGridSkeleton } from "@/components/card-grid-skeleton";
import { ScopeError } from "@/components/scope-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PAGE_SIZE,
  getCompleteArtists,
  getPagerState,
  getServerPagerState,
  loadMoreArtists,
  resetArtists,
  storeCompleteArtists,
  retryArtists,
  subscribePager,
} from "@/lib/artist-pager";
import { formatUpdatedAt } from "@/lib/client-cache";
import type { DownloadProgress, MusicService } from "@/lib/music";
import { SERVICE_LABELS } from "@/lib/music";
import { SERVICES } from "@/lib/services";
import { cn } from "@/lib/utils";

/**
 * Artists with infinite scroll: batches of the same size for every service
 * (see `@/lib/artist-pager`), the next one loaded when the bottom of the list
 * comes into view.
 *
 * The complete list exists only in the .txt download, which walks every page on
 * the server when (and only when) the download button is pressed.
 */
export function FollowedArtists({
  userId,
  service,
  otherUserId,
}: {
  userId: string;
  service: MusicService;
  /** The account on the other service, when it is connected too. */
  otherUserId?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const config = SERVICES[service];

  const state = useSyncExternalStore(
    subscribePager,
    () => getPagerState(service, userId),
    getServerPagerState,
  );
  const {
    items: artists,
    loading,
    done,
    error,
    sessionExpired,
    missingScope,
    complete,
    updatedAt,
  } = state;

  const loadMore = useCallback(
    () => void loadMoreArtists(service, userId),
    [service, userId],
  );

  // First batch, unless the complete list is cached or a batch is already loaded.
  useEffect(() => {
    const current = getPagerState(service, userId);
    if (current.items.length === 0 && !current.complete) loadMore();
  }, [service, userId, loadMore]);

  useEffect(() => {
    if (sessionExpired) router.push("/");
  }, [sessionExpired, router]);

  // Loads the next batch when the sentinel below the grid gets near the viewport.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || done || error) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // `artists.length`: a batch that still leaves the sentinel on screen (a
    // tall window) must trigger the next one, and re-observing does that.
  }, [loadMore, done, error, artists.length]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return artists;
    return artists.filter(
      (artist) =>
        artist.name.toLowerCase().includes(term) ||
        artist.genres.some((genre) => genre.toLowerCase().includes(term)),
    );
  }, [artists, query]);

  const firstLoad = loading && artists.length === 0;

  const otherService: MusicService =
    service === "spotify" ? "youtube-music" : "spotify";

  /**
   * The comparison needs BOTH complete lists, which only the download leaves in
   * localStorage. Read through the pager's store so it updates as soon as a
   * download finishes; false on the server, where there is no localStorage.
   */
  const bothDownloaded = useSyncExternalStore(
    subscribePager,
    () =>
      Boolean(
        otherUserId &&
          getCompleteArtists(service, userId) &&
          getCompleteArtists(otherService, otherUserId),
      ),
    () => false,
  );

  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const downloading = progress !== null;

  /**
   * The complete list, page by page so the bar can move. It is saved in
   * localStorage (so the page opens with every artist next time) and turned
   * into the .txt here.
   */
  async function downloadAll() {
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    setDownloadError(null);
    setProgress({ done: 0, total: null, found: 0 });

    try {
      const artists = config.artists.sort(
        await config.artists.fetchAll({
          signal: controller.signal,
          onProgress: setProgress,
        }),
      );
      storeCompleteArtists(service, userId, artists);

      // CRLF and BOM so the file opens correctly in Windows Notepad.
      const body =
        "\uFEFF" + artists.map((artist) => artist.name).join("\r\n") + "\r\n";
      const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const date = new Date().toISOString().slice(0, 10);

      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${config.artists.exportFilePrefix}-${date}.txt`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setDownloadError(
          cause instanceof Error ? cause.message : "The download failed",
        );
      }
    } finally {
      downloadAbortRef.current = null;
      setProgress(null);
    }
  }

  const percent =
    progress?.total && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          <p>
            {firstLoad
              ? "Loading your artists…"
              : complete
                ? `${artists.length} artists · complete list`
                : `${artists.length} artists loaded${done ? "" : " · scroll for more"}`}
            {query ? ` · ${filtered.length} match` : null}
          </p>
          <p className="text-xs opacity-70">
            {complete && updatedAt
              ? `Cached · updated ${formatUpdatedAt(updatedAt)}`
              : "Downloading the .txt fetches every artist and keeps the list here."}
          </p>
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
            onClick={() => resetArtists(service, userId)}
            disabled={loading}
            title={`Clear the cache and load the first ${PAGE_SIZE} artists again from ${config.label}`}
          >
            <RefreshCw className={cn(loading && "animate-spin")} />
            <span className="sr-only">Refresh from {config.label}</span>
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={downloadAll}
            disabled={downloading}
            title="Download a .txt with EVERY artist and keep the full list on this page (reads all pages, can take a while)"
          >
            {downloading ? <Loader2 className="animate-spin" /> : <Download />}
            <span className="sr-only">
              Download the complete list as .txt
            </span>
          </Button>
        </div>
      </div>

      {missingScope !== null && (
        <ScopeError service={service} detail={missingScope} />
      )}

      {otherUserId && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/25 p-3">
          <p className="mr-auto text-sm text-muted-foreground">
            {bothDownloaded
              ? "Compare both libraries:"
              : "Download the complete list on both artists pages to compare them."}
          </p>
          {(["spotify", "youtube-music"] as const).map((only) => (
            <Button
              key={only}
              asChild={bothDownloaded}
              size="sm"
              variant="outline"
              disabled={!bothDownloaded}
              className={SERVICES[only].themeClass}
              title={
                bothDownloaded
                  ? `Artists you follow on ${SERVICE_LABELS[only]} and not on the other service`
                  : "Both complete lists have to be downloaded first"
              }
            >
              {bothDownloaded ? (
                <Link href={`/compare?side=${only}`}>
                  <ArrowLeftRight />
                  Only on {SERVICE_LABELS[only]}
                </Link>
              ) : (
                <span>
                  <ArrowLeftRight />
                  Only on {SERVICE_LABELS[only]}
                </span>
              )}
            </Button>
          ))}
        </div>
      )}

      {progress && (
        <div className="flex flex-col gap-2 rounded-xl border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Reading every page for the .txt. The complete list will stay on
              this page.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => downloadAbortRef.current?.abort()}
            >
              Cancel
            </Button>
          </div>

          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total ?? undefined}
            aria-valuenow={progress.done}
          >
            <div
              className={cn(
                "h-full rounded-full bg-primary transition-[width] duration-300",
                // Unknown total: a slim moving bar instead of a wrong percentage.
                percent === null && "w-1/3 animate-pulse",
              )}
              style={percent === null ? undefined : { width: `${percent}%` }}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            {progress.label ? `${progress.label} · ` : ""}
            {progress.total
              ? `${progress.done.toLocaleString("en-US")} of ${progress.total.toLocaleString("en-US")} read`
              : `${progress.done.toLocaleString("en-US")} read`}
            {` · ${progress.found.toLocaleString("en-US")} artists found`}
          </p>
        </div>
      )}

      {downloadError && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          {downloadError}
        </p>
      )}

      {error && (
        <p className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          {error}
          <Button size="sm" variant="outline" onClick={() => retryArtists(service, userId)}>
            Retry
          </Button>
        </p>
      )}

      {firstLoad ? (
        <CardGridSkeleton shape="circle" />
      ) : artists.length === 0 && done ? (
        <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          {config.artists.emptyMessage}
        </p>
      ) : (
        <>
          {filtered.length === 0 && query ? (
            <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
              No loaded artist matches the filter.
              {!done && " Scroll down to load more."}
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

          <div ref={sentinelRef} className="flex justify-center py-4 text-sm text-muted-foreground" aria-live="polite">
            {loading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                Loading more…
              </span>
            ) : done && artists.length > 0 ? (
              "That's all."
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

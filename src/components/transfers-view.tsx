"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Link2,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  continueAll,
  continueJob,
  getServerTransferState,
  getTransferState,
  initTransfers,
  markReviewed,
  nextQuotaReset,
  pauseJob,
  removeAddedTrack,
  removeJob,
  retryUnmatched,
  setTrackVideo,
  subscribeTransfers,
  summarizeJob,
  type JobStatus,
  type TransferJob,
  type TransferTrack,
} from "@/lib/transfer-store";
import { cn } from "@/lib/utils";
import {
  youtubeMusicPlaylistUrl,
  youtubeMusicWatchUrl,
} from "@/lib/youtube-client";

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Queued",
  running: "Copying…",
  paused: "Paused",
  "paused-quota": "Waiting for quota",
  done: "Done",
  error: "Stopped",
};

const timeFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function TransfersView({
  spotifyUserId,
  youtubeUserId,
}: {
  spotifyUserId: string;
  youtubeUserId: string;
}) {
  useEffect(() => {
    initTransfers(spotifyUserId, youtubeUserId);
  }, [spotifyUserId, youtubeUserId]);

  const state = useSyncExternalStore(
    subscribeTransfers,
    getTransferState,
    getServerTransferState,
  );

  const jobs = useMemo(() => [...state.jobs].reverse(), [state.jobs]);
  const waitingQuota = state.jobs.some((job) => job.status === "paused-quota");
  const resumable = state.jobs.some(
    (job) => job.status === "paused" || job.status === "paused-quota",
  );

  if (jobs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
        <p>No copies yet.</p>
        <p className="mt-1 text-sm">
          Select playlists on your{" "}
          <Link href="/playlists" className="underline">
            Spotify playlists
          </Link>{" "}
          page and press “Copy to YouTube Music”.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {waitingQuota && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <p>
            YouTube&apos;s daily quota is used up. It resets around{" "}
            <strong>{timeFormat.format(nextQuotaReset())}</strong> (midnight
            Pacific time). Come back then and press Continue.
          </p>
          <Button size="sm" variant="outline" onClick={continueAll}>
            <Play />
            Try now
          </Button>
        </div>
      )}

      {!waitingQuota && resumable && !state.running && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 p-4 text-sm">
          <p>Some copies are paused.</p>
          <Button size="sm" onClick={continueAll}>
            <Play />
            Continue all
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Copies run in this tab. You can move around the app, but closing or
        reloading the tab pauses them; progress is saved.
      </p>

      <ul className="flex flex-col gap-4">
        {jobs.map((job) => (
          <li key={job.id}>
            <JobCard job={job} queueRunning={state.running} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function JobCard({ job, queueRunning }: { job: TransferJob; queueRunning: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const summary = summarizeJob(job);
  const percent = summary.total
    ? Math.round((summary.processed / summary.total) * 100)
    : 0;
  const playlistId = job.target.playlistId;

  const reviewTracks = (job.tracks ?? []).filter((track) =>
    showAll ? track.status !== "pending" : needsReview(track),
  );

  return (
    <article className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">
            <a href={job.source.url} target="_blank" rel="noreferrer" className="hover:underline">
              {job.source.name}
            </a>
            <span className="px-2 text-muted-foreground">→</span>
            {playlistId ? (
              <a
                href={youtubeMusicPlaylistUrl(playlistId)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:underline"
              >
                {job.target.title}
                <ExternalLink className="size-3" />
              </a>
            ) : (
              <span>{job.target.title}</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {job.target.mode === "new" ? `New ${job.target.privacyStatus} playlist` : "Existing playlist"}
            {" · "}
            <span
              className={cn(
                job.status === "error" && "text-destructive",
                job.status === "done" && "text-primary",
              )}
            >
              {STATUS_LABEL[job.status]}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {job.status === "running" || job.status === "queued" ? (
            <Button size="sm" variant="outline" onClick={() => pauseJob(job.id)}>
              <Pause />
              Pause
            </Button>
          ) : job.status !== "done" ? (
            <Button size="sm" onClick={() => continueJob(job.id)}>
              <Play />
              Continue
            </Button>
          ) : null}

          {(summary.counts["not-found"] > 0 || summary.counts.failed > 0) &&
            job.status !== "running" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => retryUnmatched(job.id)}
                title="Search again for the songs that were not found or failed"
              >
                <RotateCcw />
                Retry unmatched
              </Button>
            )}

          {job.status !== "running" && (
            <Button
              size="icon"
              variant="outline"
              onClick={() => removeJob(job.id)}
              title="Remove from this list (the YouTube playlist is kept)"
            >
              <Trash2 />
              <span className="sr-only">Remove from list</span>
            </Button>
          )}
        </div>
      </header>

      {job.error && (
        <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          {job.error}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <div
          className="h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={summary.total}
          aria-valuenow={summary.processed}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {job.status === "running" && queueRunning && (
            <Loader2 className="size-3 animate-spin" />
          )}
          {job.tracks === null ? (
            <span>Reading the Spotify playlist…</span>
          ) : (
            <>
              <span>
                {summary.processed} / {summary.total} tracks
              </span>
              <span>{summary.counts.added} added</span>
              {summary.counts.duplicate > 0 && (
                <span>{summary.counts.duplicate} already there</span>
              )}
              {summary.counts["not-found"] > 0 && (
                <span>{summary.counts["not-found"]} not found</span>
              )}
              {summary.counts.failed > 0 && (
                <span className="text-destructive">{summary.counts.failed} failed</span>
              )}
              {summary.counts.skipped > 0 && (
                <span>{summary.counts.skipped} skipped</span>
              )}
              {summary.counts.removed > 0 && (
                <span>{summary.counts.removed} removed</span>
              )}
            </>
          )}
        </p>
      </div>

      {job.tracks && job.tracks.length > 0 && (
        <details className="group" open={summary.needsReview > 0 && job.status !== "running"}>
          <summary className="cursor-pointer text-sm font-medium select-none">
            {summary.needsReview > 0
              ? `Review ${summary.needsReview} song${summary.needsReview === 1 ? "" : "s"}`
              : "Tracks"}
          </summary>

          <div className="mt-3 flex flex-col gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(event) => setShowAll(event.target.checked)}
                className="accent-primary"
              />
              Show every processed track, not only the ones to review
            </label>

            {reviewTracks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing to review.</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-lg border">
                {reviewTracks.map((track) => (
                  <li key={track.index}>
                    <TrackRow jobId={job.id} track={track} canEdit={Boolean(playlistId)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}
    </article>
  );
}

function needsReview(track: TransferTrack) {
  if (track.reviewed) return false;
  return (
    track.status === "not-found" ||
    track.status === "failed" ||
    (track.status === "added" && track.confidence === "low")
  );
}

const TRACK_STATUS_LABEL: Record<TransferTrack["status"], string> = {
  pending: "Pending",
  added: "Added",
  duplicate: "Already in the playlist",
  "not-found": "Not found",
  skipped: "Skipped",
  failed: "Failed",
  removed: "Removed",
};

function TrackRow({
  jobId,
  track,
  canEdit,
}: {
  jobId: string;
  track: TransferTrack;
  canEdit: boolean;
}) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setLink("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "It did not work");
    } finally {
      setBusy(false);
    }
  }

  const doubtful = track.status === "added" && track.confidence === "low";
  const searchUrl = `https://music.youtube.com/search?q=${encodeURIComponent(
    `${track.artists[0] ?? ""} ${track.name}`,
  )}`;

  return (
    <div className="flex flex-col gap-2 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">
            {track.artists.join(", ") || "Unknown artist"} — {track.name}
          </p>
          <p className="text-xs text-muted-foreground">
            <span className={cn(doubtful && "text-amber-500", track.status === "failed" && "text-destructive")}>
              {doubtful ? "Added · doubtful match" : TRACK_STATUS_LABEL[track.status]}
            </span>
            {track.confidence === "manual" && " · picked by you"}
            {track.error && ` · ${track.error}`}
          </p>
          {track.videoId && (
            <a
              href={youtubeMusicWatchUrl(track.videoId)}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              <span className="truncate">
                {track.videoTitle} · {track.channelTitle}
              </span>
              <ExternalLink className="size-3 shrink-0" />
            </a>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {doubtful && !track.reviewed && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => markReviewed(jobId, track.index)}>
              <Check />
              Looks right
            </Button>
          )}
          {track.status === "added" && track.itemId && canEdit && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => run(() => removeAddedTrack(jobId, track.index))}
              title="Remove this video from the YouTube playlist (50 quota units)"
            >
              <Trash2 />
              Remove
            </Button>
          )}
          {track.status === "not-found" && !track.reviewed && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => markReviewed(jobId, track.index)}>
              Ignore
            </Button>
          )}
        </div>
      </div>

      {canEdit && track.status !== "skipped" && (doubtful || track.status !== "added") && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (link.trim()) void run(() => setTrackVideo(jobId, track.index, link));
          }}
        >
          <a
            href={searchUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline"
          >
            Search on YouTube Music
            <ExternalLink className="size-3" />
          </a>
          <Input
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="Paste the right song's link"
            aria-label={`YouTube link for ${track.name}`}
            className="h-8 min-w-48 flex-1 text-xs"
            disabled={busy}
          />
          <Button size="sm" type="submit" disabled={busy || !link.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Link2 />}
            {track.itemId ? "Replace" : "Add"}
          </Button>
        </form>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

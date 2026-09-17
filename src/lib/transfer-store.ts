/**
 * Queue of Spotify -> YouTube Music playlist copies.
 *
 * YouTube's default quota (10,000 units a day) only covers ~65 searched and
 * inserted tracks, so a copy has to survive reloads and span days. Everything
 * lives in localStorage and every finished track is saved immediately: when the
 * quota runs out the job is marked "paused-quota" and "Continue" picks it up at
 * the first pending track. Searches are cached per YouTube account, so a track
 * is never paid for twice.
 *
 * The runner is a module-level loop, so it keeps going while the user moves
 * between pages of the app, and stops only when the tab is closed or reloaded.
 */

import {
  ApiError,
  MissingScopeError,
  QuotaExceededError,
  SessionExpiredError,
} from "@/lib/api-client";
import type { ExportedTrack, PlaylistSummary } from "@/lib/music";
import { fetchAllPlaylistTracks } from "@/lib/spotify-client";
import {
  addVideoToYouTubePlaylist,
  createYouTubePlaylist,
  fetchPlaylistVideoIds,
  matchTrackOnYouTube,
  removeYouTubePlaylistItem,
  type PrivacyStatus,
  type VideoMatch,
} from "@/lib/youtube-client";
import { normalizeText, parseVideoId } from "@/lib/youtube-match";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type TrackStatus =
  | "pending"
  /** In the playlist, added by this copy. */
  | "added"
  /** The matched video was already in the playlist. */
  | "duplicate"
  | "not-found"
  /** Podcast episodes and other things that are not songs. */
  | "skipped"
  | "failed"
  /** Added, then removed by the user during review. */
  | "removed";

export type TransferTrack = {
  index: number;
  name: string;
  artists: string[];
  album: string | null;
  durationMs?: number;
  status: TrackStatus;
  videoId?: string;
  videoTitle?: string;
  channelTitle?: string;
  /** Playlist item id, needed to remove the entry again. */
  itemId?: string;
  confidence?: "high" | "low" | "manual";
  reviewed?: boolean;
  /** Ignore the search cache next time (set by "retry"). */
  forceSearch?: boolean;
  error?: string;
};

export type TransferTarget =
  | {
      mode: "new";
      title: string;
      description: string;
      privacyStatus: PrivacyStatus;
      /** Set as soon as the playlist exists, so a resume never creates it twice. */
      playlistId?: string;
    }
  | { mode: "existing"; title: string; playlistId: string };

export type JobStatus =
  | "queued"
  | "running"
  | "paused"
  | "paused-quota"
  | "done"
  | "error";

export type TransferJob = {
  id: string;
  source: { id: string; name: string; url: string };
  target: TransferTarget;
  status: JobStatus;
  error?: string;
  /** null until the Spotify tracks have been read. */
  tracks: TransferTrack[] | null;
  createdAt: number;
  updatedAt: number;
};

export type TransferState = {
  jobs: TransferJob[];
  running: boolean;
  /** Epoch ms of the last quota stop, to show when it resets. */
  quotaHitAt: number | null;
};

type CachedMatch = (VideoMatch & { at: number }) | { videoId: null; at: number };

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

const STATE_VERSION = 1;
/** A "not found" is retried automatically after this long. */
const NOT_FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Stop a job after this many consecutive unexpected failures. */
const MAX_CONSECUTIVE_FAILURES = 3;

const EMPTY: TransferState = { jobs: [], running: false, quotaHitAt: null };

let scope: { spotifyId: string; youtubeId: string } | null = null;
let state: TransferState = EMPTY;
let matchCache: Record<string, CachedMatch> = {};
let controller: AbortController | null = null;
const listeners = new Set<() => void>();

function stateKey() {
  return `playlistapp:transfers:${scope!.spotifyId}:${scope!.youtubeId}`;
}

function cacheKey() {
  return `playlistapp:yt-match-cache:${scope!.youtubeId}`;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota full or storage blocked: the copy keeps working for this tab.
  }
}

function persist() {
  if (!scope) return;
  writeJson(stateKey(), {
    version: STATE_VERSION,
    jobs: state.jobs,
    quotaHitAt: state.quotaHitAt,
  });
}

function publish(next: TransferState) {
  state = next;
  persist();
  for (const listener of listeners) listener();
}

/**
 * Binds the store to the pair of accounts. A different pair (another Spotify or
 * Google login in the same browser) gets its own queue.
 */
export function initTransfers(spotifyId: string, youtubeId: string) {
  if (typeof window === "undefined") return;
  if (scope?.spotifyId === spotifyId && scope.youtubeId === youtubeId) return;

  controller?.abort();
  scope = { spotifyId, youtubeId };

  const saved = readJson<{
    version: number;
    jobs: TransferJob[];
    quotaHitAt: number | null;
  }>(stateKey());

  const jobs =
    saved?.version === STATE_VERSION && Array.isArray(saved.jobs)
      ? saved.jobs.map((job) =>
          // A reload interrupted it: it is resumable, not running.
          job.status === "running" ? { ...job, status: "paused" as const } : job,
        )
      : [];

  matchCache = readJson<Record<string, CachedMatch>>(cacheKey()) ?? {};
  state = { jobs, running: false, quotaHitAt: saved?.quotaHitAt ?? null };
  for (const listener of listeners) listener();
}

export function subscribeTransfers(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTransferState(): TransferState {
  return state;
}

export function getServerTransferState(): TransferState {
  return EMPTY;
}

function updateJob(id: string, update: (job: TransferJob) => TransferJob) {
  publish({
    ...state,
    jobs: state.jobs.map((job) =>
      job.id === id ? { ...update(job), updatedAt: Date.now() } : job,
    ),
  });
}

function updateTrack(
  jobId: string,
  index: number,
  patch: Partial<TransferTrack>,
) {
  updateJob(jobId, (job) => ({
    ...job,
    tracks:
      job.tracks?.map((track) =>
        track.index === index ? { ...track, ...patch } : track,
      ) ?? null,
  }));
}

function findJob(id: string) {
  return state.jobs.find((job) => job.id === id);
}

/* ------------------------------------------------------------------ */
/* Queue management                                                    */
/* ------------------------------------------------------------------ */

export type NewTarget =
  | { mode: "new"; privacyStatus: PrivacyStatus; title?: string }
  | { mode: "existing"; playlistId: string; title: string };

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Adds one job per playlist and starts the runner. */
export function enqueueTransfers(
  playlists: PlaylistSummary[],
  target: NewTarget,
) {
  const now = Date.now();
  const jobs: TransferJob[] = playlists.map((playlist) => ({
    id: newId(),
    source: { id: playlist.id, name: playlist.name, url: playlist.url },
    target:
      target.mode === "new"
        ? {
            mode: "new",
            // A custom title only makes sense for a single playlist.
            title:
              (playlists.length === 1 && target.title?.trim()) || playlist.name,
            description: `Copied from Spotify: ${playlist.url}`,
            privacyStatus: target.privacyStatus,
          }
        : { mode: "existing", playlistId: target.playlistId, title: target.title },
    status: "queued",
    tracks: null,
    createdAt: now,
    updatedAt: now,
  }));

  publish({ ...state, jobs: [...state.jobs, ...jobs] });
  void runQueue();
}

export function continueJob(id: string) {
  updateJob(id, (job) => ({ ...job, status: "queued", error: undefined }));
  void runQueue();
}

/** Resumes everything that stopped for quota or was paused. */
export function continueAll() {
  publish({
    ...state,
    jobs: state.jobs.map((job) =>
      job.status === "paused" || job.status === "paused-quota"
        ? { ...job, status: "queued" as const, error: undefined }
        : job,
    ),
  });
  void runQueue();
}

export function pauseJob(id: string) {
  const job = findJob(id);
  if (!job) return;
  if (job.status === "running") controller?.abort();
  updateJob(id, (current) => ({ ...current, status: "paused" }));
}

export function removeJob(id: string) {
  const job = findJob(id);
  if (!job || job.status === "running") return;
  publish({ ...state, jobs: state.jobs.filter((current) => current.id !== id) });
}

/** Puts not-found and failed tracks back in line, bypassing the search cache. */
export function retryUnmatched(id: string) {
  updateJob(id, (job) => ({
    ...job,
    status: job.status === "running" ? job.status : "queued",
    tracks:
      job.tracks?.map((track) =>
        track.status === "not-found" || track.status === "failed"
          ? { ...track, status: "pending", forceSearch: true, error: undefined }
          : track,
      ) ?? null,
  }));
  void runQueue();
}

export function markReviewed(jobId: string, index: number, reviewed = true) {
  updateTrack(jobId, index, { reviewed });
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

class JobStop extends Error {}

function matchKey(track: { name: string; artists: string[] }) {
  return `${normalizeText(track.artists.join(" "))}|${normalizeText(track.name)}`;
}

function toTransferTracks(tracks: ExportedTrack[]): TransferTrack[] {
  return tracks.map((track, index) => ({
    index,
    name: track.name,
    artists: track.artists,
    album: track.album,
    durationMs: track.durationMs,
    status: track.type === "episode" ? "skipped" : "pending",
    error: track.type === "episode" ? "Podcast episodes are not copied" : undefined,
  }));
}

async function lookUp(
  track: TransferTrack,
  signal: AbortSignal,
): Promise<VideoMatch | null> {
  const key = matchKey(track);
  const cached = matchCache[key];

  if (cached && !track.forceSearch) {
    if (cached.videoId) return cached;
    if (Date.now() - cached.at < NOT_FOUND_TTL_MS) return null;
  }

  const match = await matchTrackOnYouTube(
    { name: track.name, artists: track.artists, durationMs: track.durationMs },
    signal,
  );

  matchCache = {
    ...matchCache,
    [key]: match ? { ...match, at: Date.now() } : { videoId: null, at: Date.now() },
  };
  writeJson(cacheKey(), matchCache);
  return match;
}

async function ensurePlaylist(job: TransferJob): Promise<string> {
  if (job.target.playlistId) return job.target.playlistId;
  if (job.target.mode !== "new") throw new JobStop("The target playlist is missing");

  const created = await createYouTubePlaylist({
    title: job.target.title,
    description: job.target.description,
    privacyStatus: job.target.privacyStatus,
  });

  updateJob(job.id, (current) => ({
    ...current,
    target: { ...(current.target as typeof job.target), playlistId: created.id },
  }));
  return created.id;
}

async function runJob(jobId: string, signal: AbortSignal) {
  let job = findJob(jobId)!;

  if (!job.tracks) {
    let tracks: ExportedTrack[];
    try {
      tracks = await fetchAllPlaylistTracks(job.source.id, signal);
    } catch (error) {
      if (error instanceof MissingScopeError) {
        throw new JobStop(
          "Spotify does not let this app read this playlist's tracks (only playlists you own or collaborate on).",
        );
      }
      throw error;
    }
    updateJob(jobId, (current) => ({ ...current, tracks: toTransferTracks(tracks) }));
    job = findJob(jobId)!;
  }

  const playlistId = await ensurePlaylist(job);

  // Refreshed on every run, so a resumed or repeated copy never adds twice.
  const existing = new Set(await fetchPlaylistVideoIds(playlistId, signal));

  let failures = 0;

  for (const track of findJob(jobId)!.tracks ?? []) {
    if (signal.aborted) return;
    if (track.status !== "pending") continue;

    // The user may have paused or removed the job between two tracks.
    const current = findJob(jobId);
    if (!current || current.status !== "running") return;

    try {
      const match = await lookUp(track, signal);

      if (!match) {
        updateTrack(jobId, track.index, {
          status: "not-found",
          forceSearch: undefined,
          error: undefined,
        });
        continue;
      }

      const matchInfo = {
        videoId: match.videoId,
        videoTitle: match.title,
        channelTitle: match.channelTitle,
        confidence: match.confidence,
        forceSearch: undefined,
        error: undefined,
      };

      if (existing.has(match.videoId)) {
        updateTrack(jobId, track.index, { ...matchInfo, status: "duplicate" });
        continue;
      }

      const item = await addVideoToYouTubePlaylist(playlistId, match.videoId, signal);
      existing.add(match.videoId);
      updateTrack(jobId, track.index, {
        ...matchInfo,
        status: "added",
        itemId: item.itemId,
      });
      failures = 0;
    } catch (error) {
      if (
        signal.aborted ||
        error instanceof QuotaExceededError ||
        error instanceof SessionExpiredError ||
        error instanceof MissingScopeError
      ) {
        throw error;
      }

      failures++;
      updateTrack(jobId, track.index, {
        status: "failed",
        error: error instanceof Error ? error.message : "Unexpected error",
      });

      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        throw new JobStop(
          `Stopped after ${failures} failures in a row: ${
            error instanceof Error ? error.message : "unexpected error"
          }`,
        );
      }
    }
  }

  updateJob(jobId, (current) =>
    current.status === "running" ? { ...current, status: "done" } : current,
  );
}

export async function runQueue() {
  if (state.running || !scope) return;

  controller = new AbortController();
  const { signal } = controller;
  publish({ ...state, running: true });

  try {
    for (;;) {
      const next = state.jobs.find((job) => job.status === "queued");
      if (!next || signal.aborted) break;

      updateJob(next.id, (job) => ({ ...job, status: "running", error: undefined }));

      try {
        await runJob(next.id, signal);
      } catch (error) {
        if (error instanceof QuotaExceededError) {
          updateJob(next.id, (job) => ({
            ...job,
            status: "paused-quota",
            error: error.message,
          }));
          publish({ ...state, quotaHitAt: Date.now() });
          // Every other job needs the same quota: stop the whole queue.
          break;
        }

        if (error instanceof SessionExpiredError || error instanceof MissingScopeError) {
          updateJob(next.id, (job) => ({
            ...job,
            status: "error",
            error:
              error instanceof MissingScopeError
                ? `A permission is missing. Sign out of YouTube Music and sign in again, allowing it to manage your YouTube account. (${error.message})`
                : "A session expired. Sign in again and press Continue.",
          }));
          break;
        }

        if (signal.aborted) {
          // Paused by the user: keep whatever status pauseJob set.
          const job = findJob(next.id);
          if (job?.status === "running") {
            updateJob(next.id, (current) => ({ ...current, status: "paused" }));
          }
          break;
        }

        updateJob(next.id, (job) => ({
          ...job,
          status: "error",
          error:
            error instanceof Error ? error.message : "The copy failed unexpectedly",
        }));
      }
    }
  } finally {
    controller = null;
    publish({ ...state, running: false });

    // Pausing one job aborts the loop; carry on with the rest of the queue.
    if (signal.aborted && state.jobs.some((job) => job.status === "queued")) {
      void runQueue();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Review actions                                                      */
/* ------------------------------------------------------------------ */

function playlistIdOf(jobId: string) {
  const id = findJob(jobId)?.target.playlistId;
  if (!id) throw new Error("This copy has no YouTube playlist yet");
  return id;
}

/** Removes an added video from the YouTube playlist (50 units). */
export async function removeAddedTrack(jobId: string, index: number) {
  const track = findJob(jobId)?.tracks?.find((t) => t.index === index);
  if (!track?.itemId) throw new Error("This track is not in the playlist");

  await removeYouTubePlaylistItem(track.itemId);
  updateTrack(jobId, index, {
    status: "removed",
    itemId: undefined,
    reviewed: true,
  });
}

/**
 * Uses a video the user picked (URL or id) for a track: removes the previous
 * one if this copy added it, then adds the new one (50-100 units).
 */
export async function setTrackVideo(jobId: string, index: number, input: string) {
  const videoId = parseVideoId(input);
  if (!videoId) throw new Error("That is not a YouTube or YouTube Music video link");

  const playlistId = playlistIdOf(jobId);
  const track = findJob(jobId)?.tracks?.find((t) => t.index === index);
  if (!track) throw new Error("Track not found");

  if (track.itemId && track.videoId === videoId) {
    updateTrack(jobId, index, { reviewed: true });
    return;
  }

  let item;
  try {
    item = await addVideoToYouTubePlaylist(playlistId, videoId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new Error("YouTube could not find that video");
    }
    throw error;
  }

  if (track.itemId) {
    await removeYouTubePlaylistItem(track.itemId).catch(() => {
      // The new video is in; a leftover old entry is better than losing both.
    });
  }

  const match: VideoMatch = {
    videoId,
    title: item.title,
    channelTitle: item.channelTitle,
    confidence: "high",
  };
  matchCache = { ...matchCache, [matchKey(track)]: { ...match, at: Date.now() } };
  writeJson(cacheKey(), matchCache);

  updateTrack(jobId, index, {
    status: "added",
    videoId,
    videoTitle: item.title,
    channelTitle: item.channelTitle,
    itemId: item.itemId,
    confidence: "manual",
    reviewed: true,
    error: undefined,
  });
}

/* ------------------------------------------------------------------ */
/* Helpers for the UI                                                  */
/* ------------------------------------------------------------------ */

export function summarizeJob(job: TransferJob) {
  const counts: Record<TrackStatus, number> = {
    pending: 0,
    added: 0,
    duplicate: 0,
    "not-found": 0,
    skipped: 0,
    failed: 0,
    removed: 0,
  };
  let needsReview = 0;

  for (const track of job.tracks ?? []) {
    counts[track.status]++;
    if (
      !track.reviewed &&
      (track.status === "not-found" ||
        track.status === "failed" ||
        (track.status === "added" && track.confidence === "low"))
    ) {
      needsReview++;
    }
  }

  const total = job.tracks?.length ?? 0;
  return { counts, total, processed: total - counts.pending, needsReview };
}

/** Quota units a job still needs, at worst (every track searched). */
export function estimateUnits(pendingTracks: number, needsPlaylist: boolean) {
  return pendingTracks * 151 + (needsPlaylist ? 50 : 0);
}

/**
 * YouTube resets the daily quota at midnight Pacific time. Returns that moment
 * as epoch ms (DST edges can be off by an hour, which is fine for a hint).
 */
export function nextQuotaReset(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const elapsed = get("hour") * 3600 + get("minute") * 60 + get("second");
  return now.getTime() + (86400 - elapsed) * 1000;
}

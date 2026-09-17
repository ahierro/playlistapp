/**
 * Queue of playlist copies between Spotify and YouTube Music, in either
 * direction.
 *
 * - Spotify -> YouTube Music: YouTube's daily quota (10,000 units) covers only
 *   ~65 searched and inserted songs, so a copy spans days. When the quota runs
 *   out the job is marked "paused-quota" and "Continue" resumes it the next day.
 * - YouTube Music -> Spotify: reading YouTube costs ~2 units per 50 songs and
 *   Spotify has no daily quota, only a short rate limit. The runner waits the
 *   seconds Spotify asks for and carries on; tracks are added in batches.
 *
 * Everything lives in localStorage and every finished track is saved at once,
 * so a copy survives reloads. Search results are cached per target account, so
 * a song is never searched twice.
 *
 * The runner is a module-level loop: it keeps going while the user moves
 * between pages of the app, and stops only when the tab is closed or reloaded.
 */

import {
  ApiError,
  MissingScopeError,
  QuotaExceededError,
  SessionExpiredError,
} from "@/lib/api-client";
import type { ExportedTrack, MusicService, PlaylistSummary } from "@/lib/music";
import { SERVICE_LABELS } from "@/lib/music";
import {
  addTracksToSpotifyPlaylist,
  createSpotifyPlaylist,
  fetchAllPlaylistTracks,
  fetchSpotifyPlaylistUris,
  lookupSpotifyTrack,
  matchTrackOnSpotify,
  removeTracksFromSpotifyPlaylist,
  spotifyPlaylistUrl,
  spotifyTrackUrl,
} from "@/lib/spotify-client";
import {
  addVideoToYouTubePlaylist,
  createYouTubePlaylist,
  fetchAllYouTubePlaylistTracks,
  fetchPlaylistVideoIds,
  matchTrackOnYouTube,
  removeYouTubePlaylistItem,
  youtubeMusicPlaylistUrl,
  youtubeMusicWatchUrl,
  type PrivacyStatus,
} from "@/lib/youtube-client";
import {
  normalizeText,
  parseSpotifyTrackId,
  parseVideoId,
} from "@/lib/youtube-match";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type Direction = "spotify-to-youtube" | "youtube-to-spotify";

export type TrackStatus =
  | "pending"
  /** In the target playlist, added by this copy. */
  | "added"
  /** The matched song was already in the target playlist. */
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
  /** YouTube video id or Spotify track URI. */
  targetId?: string;
  targetTitle?: string;
  targetSubtitle?: string;
  /** YouTube playlist item id, needed to remove the entry again. */
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
  direction: Direction;
  source: { id: string; name: string; url: string };
  target: TransferTarget;
  status: JobStatus;
  error?: string;
  /** Short-lived message, e.g. while waiting out a Spotify rate limit. */
  notice?: string;
  /** Why a "paused-quota" job stopped. */
  pausedBy?: "youtube-quota" | "spotify-rate-limit";
  /** null until the source tracks have been read. */
  tracks: TransferTrack[] | null;
  createdAt: number;
  updatedAt: number;
};

export type TransferState = {
  jobs: TransferJob[];
  running: boolean;
  /** Epoch ms of the last YouTube quota stop, to show when it resets. */
  quotaHitAt: number | null;
};

type TargetMatch = {
  targetId: string;
  title: string;
  subtitle: string;
  confidence: "high" | "low";
};

type CachedMatch = (TargetMatch & { at: number }) | { targetId: null; at: number };

type AddResult = { itemId?: string; title?: string; subtitle?: string };

/** Everything that differs between the two directions. */
type Adapter = {
  source: MusicService;
  target: MusicService;
  readSource: (playlistId: string, signal: AbortSignal) => Promise<ExportedTrack[]>;
  createPlaylist: (
    target: Extract<TransferTarget, { mode: "new" }>,
  ) => Promise<string>;
  existingIds: (playlistId: string, signal: AbortSignal) => Promise<string[]>;
  search: (track: TransferTrack, signal: AbortSignal) => Promise<TargetMatch | null>;
  /** Adds `ids` in order; the result is keyed by id. */
  addMany: (
    playlistId: string,
    ids: string[],
    signal?: AbortSignal,
  ) => Promise<Map<string, AddResult>>;
  /** How many tracks one add request takes. */
  batchSize: number;
  remove: (playlistId: string, track: TransferTrack) => Promise<void>;
  /** A link or id the user pasted, resolved to a target track. */
  resolveLink: (input: string) => Promise<Omit<TargetMatch, "confidence">>;
  /** Which account's match cache to use. */
  cacheOwner: "youtube" | "spotify";
  playlistUrl: (playlistId: string) => string;
  trackUrl: (targetId: string) => string;
  searchUrl: (track: TransferTrack) => string;
  linkHint: string;
};

/* ------------------------------------------------------------------ */
/* Adapters                                                            */
/* ------------------------------------------------------------------ */

const toYouTube: Adapter = {
  source: "spotify",
  target: "youtube-music",
  readSource: async (id, signal) => {
    try {
      return await fetchAllPlaylistTracks(id, signal);
    } catch (error) {
      if (error instanceof MissingScopeError) {
        throw new JobStop(
          "Spotify does not let this app read this playlist's tracks (only playlists you own or collaborate on).",
        );
      }
      throw error;
    }
  },
  createPlaylist: async (target) =>
    (
      await createYouTubePlaylist({
        title: target.title,
        description: target.description,
        privacyStatus: target.privacyStatus,
      })
    ).id,
  existingIds: fetchPlaylistVideoIds,
  search: async (track, signal) => {
    const match = await matchTrackOnYouTube(
      { name: track.name, artists: track.artists, durationMs: track.durationMs },
      signal,
    );
    return match
      ? {
          targetId: match.videoId,
          title: match.title,
          subtitle: match.channelTitle,
          confidence: match.confidence,
        }
      : null;
  },
  addMany: async (playlistId, ids, signal) => {
    const result = new Map<string, AddResult>();
    for (const id of ids) {
      const item = await addVideoToYouTubePlaylist(playlistId, id, signal);
      result.set(id, {
        itemId: item.itemId,
        title: item.title,
        subtitle: item.channelTitle,
      });
    }
    return result;
  },
  batchSize: 1,
  remove: async (_playlistId, track) => {
    if (!track.itemId) throw new Error("This track is not in the playlist");
    await removeYouTubePlaylistItem(track.itemId);
  },
  resolveLink: async (input) => {
    const videoId = parseVideoId(input);
    if (!videoId) {
      throw new Error("That is not a YouTube or YouTube Music video link");
    }
    // Title and channel come back from the insert.
    return { targetId: videoId, title: "", subtitle: "" };
  },
  cacheOwner: "youtube",
  playlistUrl: youtubeMusicPlaylistUrl,
  trackUrl: youtubeMusicWatchUrl,
  searchUrl: (track) =>
    `https://music.youtube.com/search?q=${encodeURIComponent(
      `${track.artists[0] ?? ""} ${track.name}`.trim(),
    )}`,
  linkHint: "Paste the right song's YouTube link",
};

const toSpotify: Adapter = {
  source: "youtube-music",
  target: "spotify",
  readSource: async (id, signal) => {
    try {
      return await fetchAllYouTubePlaylistTracks(id, signal);
    } catch (error) {
      if (error instanceof MissingScopeError) {
        throw new JobStop(
          `YouTube did not let this app read this playlist. ${error.message}`,
        );
      }
      throw error;
    }
  },
  createPlaylist: async (target) =>
    (
      await createSpotifyPlaylist({
        title: target.title,
        description: target.description,
        privacyStatus: target.privacyStatus === "public" ? "public" : "private",
      })
    ).id,
  existingIds: fetchSpotifyPlaylistUris,
  search: async (track, signal) => {
    const match = await matchTrackOnSpotify(
      { name: track.name, artists: track.artists, durationMs: track.durationMs },
      signal,
    );
    return match
      ? {
          targetId: match.uri,
          title: match.name,
          subtitle: match.artists.join(", "),
          confidence: match.confidence,
        }
      : null;
  },
  addMany: async (playlistId, ids, signal) => {
    await addTracksToSpotifyPlaylist(playlistId, ids, signal);
    return new Map(ids.map((id) => [id, {}]));
  },
  batchSize: 50,
  remove: async (playlistId, track) => {
    if (!track.targetId) throw new Error("This track is not in the playlist");
    await removeTracksFromSpotifyPlaylist(playlistId, [track.targetId]);
  },
  resolveLink: async (input) => {
    const id = parseSpotifyTrackId(input);
    if (!id) throw new Error("That is not a Spotify track link");
    try {
      const track = await lookupSpotifyTrack(id);
      return {
        targetId: track.uri,
        title: track.name,
        subtitle: track.artists.join(", "),
      };
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
        throw new Error("Spotify could not find that track");
      }
      throw error;
    }
  },
  cacheOwner: "spotify",
  playlistUrl: spotifyPlaylistUrl,
  trackUrl: spotifyTrackUrl,
  searchUrl: (track) =>
    `https://open.spotify.com/search/${encodeURIComponent(
      `${track.artists[0] ?? ""} ${track.name}`.trim(),
    )}`,
  linkHint: "Paste the right Spotify track link",
};

export const ADAPTERS: Record<Direction, Adapter> = {
  "spotify-to-youtube": toYouTube,
  "youtube-to-spotify": toSpotify,
};

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

const STATE_VERSION = 1;
/** A "not found" is retried automatically after this long. */
const NOT_FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Stop a job after this many consecutive unexpected failures. */
const MAX_CONSECUTIVE_FAILURES = 3;
/** Spotify rate-limit waits longer than this pause the job instead. */
const MAX_RATE_LIMIT_WAIT_S = 60;
const MAX_RATE_LIMIT_RETRIES = 5;

const EMPTY: TransferState = { jobs: [], running: false, quotaHitAt: null };

let scope: { spotifyId: string; youtubeId: string } | null = null;
let state: TransferState = EMPTY;
const matchCaches: Record<Adapter["cacheOwner"], Record<string, CachedMatch>> = {
  youtube: {},
  spotify: {},
};
let controller: AbortController | null = null;
const listeners = new Set<() => void>();

function stateKey() {
  return `playlistapp:transfers:${scope!.spotifyId}:${scope!.youtubeId}`;
}

function cacheKey(owner: Adapter["cacheOwner"]) {
  return owner === "youtube"
    ? `playlistapp:yt-match-cache:${scope!.youtubeId}`
    : `playlistapp:sp-match-cache:${scope!.spotifyId}`;
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

type LegacyTrack = TransferTrack & {
  videoId?: string;
  videoTitle?: string;
  channelTitle?: string;
};
type LegacyMatch = { videoId?: string | null; title?: string; channelTitle?: string };

/** Jobs saved before copies had a direction were all Spotify -> YouTube. */
function migrateJob(job: TransferJob): TransferJob {
  const direction = job.direction ?? "spotify-to-youtube";
  const tracks =
    job.tracks?.map((raw) => {
      const { videoId, videoTitle, channelTitle, ...track } = raw as LegacyTrack;
      return {
        ...track,
        targetId: track.targetId ?? videoId,
        targetTitle: track.targetTitle ?? videoTitle,
        targetSubtitle: track.targetSubtitle ?? channelTitle,
      };
    }) ?? null;

  return {
    ...job,
    direction,
    tracks,
    notice: undefined,
    // A reload interrupted it: it is resumable, not running.
    status: job.status === "running" ? "paused" : job.status,
  };
}

function migrateCache(raw: Record<string, unknown>) {
  const out: Record<string, CachedMatch> = {};
  for (const [key, value] of Object.entries(raw)) {
    const entry = value as Partial<TargetMatch> &
      LegacyMatch & { targetId?: string | null; at?: number };
    const at = typeof entry.at === "number" ? entry.at : 0;
    const targetId = entry.targetId !== undefined ? entry.targetId : entry.videoId;

    out[key] = targetId
      ? {
          targetId,
          title: entry.title ?? "",
          subtitle: entry.subtitle ?? entry.channelTitle ?? "",
          confidence: entry.confidence ?? "high",
          at,
        }
      : { targetId: null, at };
  }
  return out;
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
      ? saved.jobs.map(migrateJob)
      : [];

  for (const owner of ["youtube", "spotify"] as const) {
    matchCaches[owner] = migrateCache(
      readJson<Record<string, unknown>>(cacheKey(owner)) ?? {},
    );
  }

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
  direction: Direction,
  playlists: PlaylistSummary[],
  target: NewTarget,
) {
  const sourceLabel = SERVICE_LABELS[ADAPTERS[direction].source];
  const now = Date.now();
  const jobs: TransferJob[] = playlists.map((playlist) => ({
    id: newId(),
    direction,
    source: { id: playlist.id, name: playlist.name, url: playlist.url },
    target:
      target.mode === "new"
        ? {
            mode: "new",
            // A custom title only makes sense for a single playlist.
            title:
              (playlists.length === 1 && target.title?.trim()) || playlist.name,
            description: `Copied from ${sourceLabel}: ${playlist.url}`,
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
  updateJob(id, (job) => ({
    ...job,
    status: "queued",
    error: undefined,
    pausedBy: undefined,
  }));
  void runQueue();
}

/** Resumes everything that stopped for quota or was paused. */
export function continueAll() {
  publish({
    ...state,
    jobs: state.jobs.map((job) =>
      job.status === "paused" || job.status === "paused-quota"
        ? { ...job, status: "queued" as const, error: undefined, pausedBy: undefined }
        : job,
    ),
  });
  void runQueue();
}

export function pauseJob(id: string) {
  const job = findJob(id);
  if (!job) return;
  if (job.status === "running") controller?.abort();
  updateJob(id, (current) => ({ ...current, status: "paused", notice: undefined }));
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

function saveMatch(
  adapter: Adapter,
  track: { name: string; artists: string[] },
  match: CachedMatch,
) {
  const owner = adapter.cacheOwner;
  matchCaches[owner] = { ...matchCaches[owner], [matchKey(track)]: match };
  writeJson(cacheKey(owner), matchCaches[owner]);
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

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/**
 * Runs `task`, waiting out short Spotify rate limits. YouTube's daily quota and
 * long waits are rethrown so the job pauses.
 */
async function withRateLimit<T>(
  jobId: string,
  task: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await task();
      if (findJob(jobId)?.notice) {
        updateJob(jobId, (job) => ({ ...job, notice: undefined }));
      }
      return result;
    } catch (error) {
      const wait =
        error instanceof QuotaExceededError &&
        error.service === SERVICE_LABELS.spotify
          ? (error.retryAfterSeconds ?? 5)
          : null;
      if (wait === null || wait > MAX_RATE_LIMIT_WAIT_S || attempt >= MAX_RATE_LIMIT_RETRIES) {
        throw error;
      }
      updateJob(jobId, (job) => ({
        ...job,
        notice: `Spotify asked to slow down. Waiting ${wait} s…`,
      }));
      await sleep(wait * 1000, signal);
    }
  }
}

async function lookUp(
  adapter: Adapter,
  track: TransferTrack,
  signal: AbortSignal,
): Promise<TargetMatch | null> {
  const cached = matchCaches[adapter.cacheOwner][matchKey(track)];

  if (cached && !track.forceSearch) {
    if (cached.targetId) return cached;
    if (Date.now() - cached.at < NOT_FOUND_TTL_MS) return null;
  }

  const match = await adapter.search(track, signal);
  saveMatch(
    adapter,
    track,
    match ? { ...match, at: Date.now() } : { targetId: null, at: Date.now() },
  );
  return match;
}

async function ensurePlaylist(job: TransferJob, adapter: Adapter): Promise<string> {
  if (job.target.playlistId) return job.target.playlistId;
  if (job.target.mode !== "new") throw new JobStop("The target playlist is missing");

  const playlistId = await adapter.createPlaylist(job.target);

  updateJob(job.id, (current) => ({
    ...current,
    target: { ...(current.target as typeof job.target), playlistId },
  }));
  return playlistId;
}

async function runJob(jobId: string, signal: AbortSignal) {
  let job = findJob(jobId)!;
  const adapter = ADAPTERS[job.direction];
  const guarded = <T>(task: () => Promise<T>) => withRateLimit(jobId, task, signal);

  if (!job.tracks) {
    const tracks = await guarded(() => adapter.readSource(job.source.id, signal));
    updateJob(jobId, (current) => ({ ...current, tracks: toTransferTracks(tracks) }));
    job = findJob(jobId)!;
  }

  const playlistId = await guarded(() => ensurePlaylist(job, adapter));

  // Refreshed on every run, so a resumed or repeated copy never adds twice.
  const existing = new Set(await guarded(() => adapter.existingIds(playlistId, signal)));

  let failures = 0;
  const batch: { index: number; match: TargetMatch }[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const items = batch.splice(0);
    const ids = items.map((item) => item.match.targetId);

    let results: Map<string, AddResult>;
    try {
      results = await guarded(() => adapter.addMany(playlistId, ids, signal));
    } catch (error) {
      // Not added: let the next run try them again (the search is cached).
      for (const id of ids) existing.delete(id);
      throw error;
    }

    for (const { index, match } of items) {
      const added = results.get(match.targetId) ?? {};
      updateTrack(jobId, index, {
        status: "added",
        targetId: match.targetId,
        targetTitle: added.title || match.title,
        targetSubtitle: added.subtitle || match.subtitle,
        itemId: added.itemId,
        confidence: match.confidence,
        forceSearch: undefined,
        error: undefined,
      });
    }
  };

  for (const track of findJob(jobId)!.tracks ?? []) {
    if (signal.aborted) return;
    if (track.status !== "pending") continue;

    // The user may have paused or removed the job between two tracks.
    const current = findJob(jobId);
    if (!current || current.status !== "running") return;

    try {
      const match = await guarded(() => lookUp(adapter, track, signal));

      if (!match) {
        updateTrack(jobId, track.index, {
          status: "not-found",
          forceSearch: undefined,
          error: undefined,
        });
        continue;
      }

      if (existing.has(match.targetId)) {
        updateTrack(jobId, track.index, {
          status: "duplicate",
          targetId: match.targetId,
          targetTitle: match.title,
          targetSubtitle: match.subtitle,
          confidence: match.confidence,
          forceSearch: undefined,
          error: undefined,
        });
        continue;
      }

      existing.add(match.targetId);
      batch.push({ index: track.index, match });
      if (batch.length >= adapter.batchSize) await flush();
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

  if (signal.aborted) return;
  await flush();

  updateJob(jobId, (current) =>
    current.status === "running" ? { ...current, status: "done", notice: undefined } : current,
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
          const youtube = error.service !== SERVICE_LABELS.spotify;
          updateJob(next.id, (job) => ({
            ...job,
            status: "paused-quota",
            pausedBy: youtube ? "youtube-quota" : "spotify-rate-limit",
            notice: undefined,
            error: youtube
              ? error.message
              : `Spotify asked to wait ${
                  error.retryAfterSeconds ? `${error.retryAfterSeconds} s` : "a while"
                }. Press Continue later.`,
          }));
          if (youtube) publish({ ...state, quotaHitAt: Date.now() });
          // Every other job needs the same service: stop the whole queue.
          break;
        }

        if (error instanceof SessionExpiredError || error instanceof MissingScopeError) {
          const target = SERVICE_LABELS[ADAPTERS[next.direction].target];
          updateJob(next.id, (job) => ({
            ...job,
            status: "error",
            notice: undefined,
            error:
              error instanceof MissingScopeError
                ? `A permission is missing. Sign out of ${target} and sign in again so the app can create and edit playlists. (${error.message})`
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
          notice: undefined,
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

function jobParts(jobId: string, index: number) {
  const job = findJob(jobId);
  const playlistId = job?.target.playlistId;
  if (!job || !playlistId) throw new Error("This copy has no target playlist yet");
  const track = job.tracks?.find((t) => t.index === index);
  if (!track) throw new Error("Track not found");
  return { job, playlistId, track, adapter: ADAPTERS[job.direction] };
}

/** Removes an added track from the target playlist. */
export async function removeAddedTrack(jobId: string, index: number) {
  const { playlistId, track, adapter } = jobParts(jobId, index);
  if (track.status !== "added") throw new Error("This track is not in the playlist");

  await adapter.remove(playlistId, track);
  updateTrack(jobId, index, {
    status: "removed",
    itemId: undefined,
    reviewed: true,
  });
}

/**
 * Uses a track the user picked (link or id): adds it, then removes the previous
 * one if this copy had added it.
 */
export async function setTrackTarget(jobId: string, index: number, input: string) {
  const { playlistId, track, adapter } = jobParts(jobId, index);
  const picked = await adapter.resolveLink(input);

  if (track.status === "added" && track.targetId === picked.targetId) {
    updateTrack(jobId, index, { reviewed: true });
    return;
  }

  let added: AddResult;
  try {
    added =
      (await adapter.addMany(playlistId, [picked.targetId])).get(picked.targetId) ?? {};
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
      throw new Error("That track could not be added");
    }
    throw error;
  }

  if (track.status === "added" && track.targetId) {
    await adapter.remove(playlistId, track).catch(() => {
      // The new track is in; a leftover old entry is better than losing both.
    });
  }

  const title = added.title || picked.title;
  const subtitle = added.subtitle || picked.subtitle;
  saveMatch(adapter, track, {
    targetId: picked.targetId,
    title,
    subtitle,
    confidence: "high",
    at: Date.now(),
  });

  updateTrack(jobId, index, {
    status: "added",
    targetId: picked.targetId,
    targetTitle: title,
    targetSubtitle: subtitle,
    itemId: added.itemId,
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

/**
 * YouTube quota units a copy needs at worst. Spotify -> YouTube: search,
 * durations and insert per song. YouTube -> Spotify: only reading the source
 * (items and durations, 2 units per 50 songs).
 */
export function estimateUnits(
  direction: Direction,
  trackCount: number,
  newPlaylists: number,
) {
  if (direction === "youtube-to-spotify") {
    return Math.ceil(trackCount / 50) * 2 + 1;
  }
  return trackCount * 151 + newPlaylists * 50;
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

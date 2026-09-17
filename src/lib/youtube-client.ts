/**
 * Browser-side fetchers for YouTube Music. They walk our own `/api/youtube/*`
 * routes and map the results into the provider-neutral shapes in `@/lib/music`.
 */

import { getJson, MAX_PAGES, sendJson, walkPages } from "@/lib/api-client";
import {
  pickImage,
  type ArtistSummary,
  type DownloadProgress,
  type ExportedTrack,
  type PlaylistSummary,
  type TracksPage,
} from "@/lib/music";
import type {
  YouTubeArtist,
  YouTubeArtistsPage,
  YouTubePlaylist,
  YouTubePlaylistsPage,
} from "@/lib/youtube";

const SERVICE = "YouTube Music";
/** Share of music videos from which a YouTube playlist counts as a music one. */
const MUSIC_THRESHOLD = 0.5;
const MUSIC_BASE = "https://music.youtube.com";

/** Must match `SUBSCRIPTION_ORDERS` in `@/lib/youtube` (a server-only module). */
const ORDERS = ["relevance", "alphabetical", "unread"] as const;

function withToken(path: string, token: string | null) {
  if (!token) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}pageToken=${encodeURIComponent(token)}`;
}

function toArtistSummary(artist: YouTubeArtist): ArtistSummary {
  return {
    id: artist.id,
    name: artist.name,
    genres: artist.genres,
    imageUrl: pickImage(artist.images, 88)?.url ?? null,
    url: `${MUSIC_BASE}/channel/${encodeURIComponent(artist.id)}`,
  };
}

function toPlaylistSummary(playlist: YouTubePlaylist): PlaylistSummary {
  return {
    id: playlist.id,
    name: playlist.title,
    ownerId: playlist.channelId,
    ownerName: playlist.channelTitle,
    collaborative: false,
    isPublic:
      playlist.privacyStatus === null ? null : playlist.privacyStatus === "public",
    imageUrl: pickImage(playlist.images, 160)?.url ?? null,
    trackCount: playlist.itemCount,
    // Mostly music, or nothing to judge yet (e.g. a new, empty playlist).
    isMusic: playlist.musicShare === null || playlist.musicShare >= MUSIC_THRESHOLD,
    url: playlist.isLikes
      ? `https://www.youtube.com/playlist?list=${encodeURIComponent(playlist.id)}`
      : `${MUSIC_BASE}/playlist?list=${encodeURIComponent(playlist.id)}`,
  };
}

/**
 * EVERY subscribed artist channel, walking the pages from the browser so the
 * download can report progress.
 *
 * `subscriptions.list` stops paginating after ~1,000 items per pass, so the
 * three orders are walked and merged; progress counts the subscriptions read
 * across all three passes.
 */
export async function fetchAllYouTubeArtists({
  signal,
  onProgress,
}: {
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
} = {}): Promise<ArtistSummary[]> {
  const byId = new Map<string, YouTubeArtist>();
  let scanned = 0;
  let total: number | null = null;

  for (const [pass, order] of ORDERS.entries()) {
    let pageToken: string | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      const data: YouTubeArtistsPage = await getJson<YouTubeArtistsPage>(
        withToken(`/api/youtube/artists?order=${order}`, pageToken),
        { signal, service: SERVICE },
      );

      for (const artist of data.items) byId.set(artist.id, artist);
      scanned += data.scanned;
      total = data.totalSubscriptions ?? total;

      onProgress?.({
        done: scanned,
        // Every pass walks the whole subscription list again.
        total: total === null ? null : total * ORDERS.length,
        found: byId.size,
        label: `Pass ${pass + 1} of ${ORDERS.length} (${order})`,
      });

      if (!data.nextPageToken || data.nextPageToken === pageToken) break;
      pageToken = data.nextPageToken;
    }
  }

  return [...byId.values()].map(toArtistSummary);
}

/**
 * Artist channels among one page of 50 subscriptions: usually fewer than 50,
 * sometimes none. The pager buffers these into fixed-size batches. The .txt
 * export walks every page on the server instead.
 */
export async function fetchYouTubeArtistsPage(
  cursor: string | null,
  { signal }: { limit: number; signal?: AbortSignal },
): Promise<{ items: ArtistSummary[]; next: string | null }> {
  const page = await getJson<YouTubeArtistsPage>(
    withToken("/api/youtube/artists?order=relevance", cursor),
    { signal, service: SERVICE },
  );
  return { items: page.items.map(toArtistSummary), next: page.nextPageToken };
}

/** Every playlist the user owns, plus "Liked videos". */
export async function fetchAllYouTubePlaylists(
  signal?: AbortSignal,
): Promise<PlaylistSummary[]> {
  const playlists = await walkPages<YouTubePlaylistsPage, YouTubePlaylist>({
    service: SERVICE,
    signal,
    pageUrl: (token) => withToken("/api/youtube/playlists", token),
    getItems: (page) => page.items,
    getNext: (page) => page.nextPageToken,
    getKey: (playlist) => playlist.id,
  });
  return playlists.map(toPlaylistSummary);
}

/** Every song of one playlist. */
export function fetchAllYouTubePlaylistTracks(
  playlistId: string,
  signal?: AbortSignal,
): Promise<ExportedTrack[]> {
  return walkPages<TracksPage, ExportedTrack>({
    service: SERVICE,
    signal,
    pageUrl: (token) =>
      withToken(
        `/api/youtube/playlists/${encodeURIComponent(playlistId)}/items`,
        token,
      ),
    getItems: (page) => page.items,
    getNext: (page) => page.next,
  });
}

/* ------------------------------------------------------------------ */
/* Writing (Spotify -> YouTube Music copy)                             */
/* ------------------------------------------------------------------ */

export type PrivacyStatus = "private" | "unlisted" | "public";

export type VideoMatch = {
  videoId: string;
  title: string;
  channelTitle: string;
  confidence: "high" | "low";
};

type MatchResponse = {
  match: (VideoMatch & { score: number }) | null;
  query: string;
};

export type AddedItem = {
  itemId: string;
  videoId: string;
  title: string;
  channelTitle: string;
};

export async function createYouTubePlaylist(input: {
  title: string;
  description?: string;
  privacyStatus: PrivacyStatus;
}): Promise<{ id: string; title: string }> {
  const created = await sendJson<{ id: string; title: string }>(
    "/api/youtube/playlists",
    { method: "POST", body: input, service: SERVICE },
  );
  if (!created) throw new Error("YouTube did not return the new playlist");
  return created;
}

/** 101 quota units. */
export async function matchTrackOnYouTube(
  track: { name: string; artists: string[]; durationMs?: number },
  signal?: AbortSignal,
): Promise<VideoMatch | null> {
  const result = await sendJson<MatchResponse>("/api/youtube/match", {
    method: "POST",
    body: track,
    service: SERVICE,
    signal,
  });
  if (!result?.match) return null;
  const { videoId, title, channelTitle, confidence } = result.match;
  return { videoId, title, channelTitle, confidence };
}

/** 50 quota units. */
export async function addVideoToYouTubePlaylist(
  playlistId: string,
  videoId: string,
  signal?: AbortSignal,
): Promise<AddedItem> {
  const item = await sendJson<AddedItem>(
    `/api/youtube/playlists/${encodeURIComponent(playlistId)}/items`,
    { method: "POST", body: { videoId }, service: SERVICE, signal },
  );
  if (!item) throw new Error("YouTube did not confirm the added video");
  return item;
}

/** 50 quota units. */
export async function removeYouTubePlaylistItem(itemId: string): Promise<void> {
  await sendJson<null>(
    `/api/youtube/playlist-items/${encodeURIComponent(itemId)}`,
    { method: "DELETE", service: SERVICE },
  );
}

/** Every video id already in a playlist (1 quota unit per 50). */
export function fetchPlaylistVideoIds(
  playlistId: string,
  signal?: AbortSignal,
): Promise<string[]> {
  return walkPages<{ videoIds: string[]; nextPageToken: string | null }, string>({
    service: SERVICE,
    signal,
    pageUrl: (token) =>
      withToken(
        `/api/youtube/playlists/${encodeURIComponent(playlistId)}/video-ids`,
        token,
      ),
    getItems: (page) => page.videoIds,
    getNext: (page) => page.nextPageToken,
  });
}

export function youtubeMusicPlaylistUrl(playlistId: string) {
  return `${MUSIC_BASE}/playlist?list=${encodeURIComponent(playlistId)}`;
}

export function youtubeMusicWatchUrl(videoId: string) {
  return `${MUSIC_BASE}/watch?v=${encodeURIComponent(videoId)}`;
}

/** Subscribes to an artist's channel on YouTube by name (150 quota units). */
export async function subscribeToArtistOnYouTube(
  name: string,
): Promise<{ name: string; url: string; imageUrl: string | null }> {
  const result = await sendJson<{
    name: string;
    url: string;
    imageUrl: string | null;
  }>("/api/youtube/subscribe", {
    method: "POST",
    body: { name },
    service: SERVICE,
  });
  if (!result) throw new Error("YouTube did not confirm the subscription");
  return result;
}

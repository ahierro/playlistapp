/**
 * Browser-side fetchers for YouTube Music. They walk our own `/api/youtube/*`
 * routes and map the results into the provider-neutral shapes in `@/lib/music`.
 */

import { sendJson, walkPages } from "@/lib/api-client";
import {
  pickImage,
  type ArtistSummary,
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

/** Must match `SUBSCRIPTION_ORDERS` in `@/lib/youtube` (server-only module). */
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
 * Every subscribed artist channel. YouTube stops paginating subscriptions after
 * ~1,000 items, so the walk is repeated for each order and the results merged
 * (see `SUBSCRIPTION_ORDERS`). Name dedupe happens in `sortYouTubeArtists`.
 */
export async function fetchAllYouTubeArtists(
  signal?: AbortSignal,
): Promise<ArtistSummary[]> {
  const byId = new Map<string, YouTubeArtist>();
  const scanned: string[] = [];

  for (const order of ORDERS) {
    let count = 0;
    let total: number | null = null;

    const artists = await walkPages<YouTubeArtistsPage, YouTubeArtist>({
      service: SERVICE,
      signal,
      pageUrl: (token) =>
        withToken(`/api/youtube/artists?order=${order}`, token),
      getItems: (page) => {
        count += page.scanned;
        total = page.totalSubscriptions ?? total;
        return page.items;
      },
      getNext: (page) => page.nextPageToken,
    });

    for (const artist of artists) byId.set(artist.id, artist);
    scanned.push(`${order}: ${count}/${total ?? "?"}`);
  }

  console.info(
    `[youtube] ${byId.size} artist channels. Subscriptions scanned per order: ${scanned.join(", ")}.`,
  );

  return [...byId.values()].map(toArtistSummary);
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

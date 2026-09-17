/**
 * Browser-side fetchers for Spotify. They walk our own `/api/spotify/*` routes
 * and map the Spotify objects into the provider-neutral shapes in `@/lib/music`.
 */

import { getJson, MAX_PAGES, sendJson, walkPages } from "@/lib/api-client";
import {
  pickImage,
  type ArtistSummary,
  type DownloadProgress,
  type ExportedTrack,
  type PlaylistSummary,
} from "@/lib/music";
import {
  playlistTrackCount,
  type FollowedArtistsPage,
  type PlaylistsPage,
  type PlaylistTracksPage,
  type SpotifyArtist,
  type SpotifyPlaylist,
} from "@/lib/spotify";

export { MissingScopeError, SessionExpiredError } from "@/lib/api-client";

const SERVICE = "Spotify";

function toArtistSummary(artist: SpotifyArtist): ArtistSummary {
  return {
    id: artist.id,
    name: artist.name,
    genres: artist.genres ?? [],
    imageUrl: pickImage(artist.images)?.url ?? null,
    url: artist.external_urls.spotify,
    followers: artist.followers?.total,
  };
}

function toPlaylistSummary(playlist: SpotifyPlaylist): PlaylistSummary {
  return {
    id: playlist.id,
    name: playlist.name,
    ownerId: playlist.owner.id,
    ownerName: playlist.owner.display_name ?? null,
    collaborative: playlist.collaborative,
    isPublic: playlist.public,
    imageUrl: pickImage(playlist.images)?.url ?? null,
    trackCount: playlistTrackCount(playlist),
    url: playlist.external_urls.spotify,
  };
}

/**
 * EVERY followed artist, walking the pages from the browser so the download can
 * report progress (Spotify sends the total on every page).
 */
export async function fetchAllFollowedArtists({
  signal,
  onProgress,
}: {
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
} = {}): Promise<ArtistSummary[]> {
  const artists: ArtistSummary[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  let total: number | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ limit: "50" });
    if (after) params.set("after", after);

    const data: FollowedArtistsPage = await getJson<FollowedArtistsPage>(
      `/api/spotify/following?${params}`,
      { signal, service: SERVICE },
    );
    total = data.total ?? total;

    for (const artist of data.items) {
      if (seen.has(artist.id)) continue;
      seen.add(artist.id);
      artists.push(toArtistSummary(artist));
    }

    onProgress?.({ done: artists.length, total, found: artists.length });

    if (!data.nextCursor || data.nextCursor === after) break;
    after = data.nextCursor;
  }

  return artists;
}

/**
 * One page of followed artists, for the infinite scroll. The .txt export walks
 * every page on the server instead.
 */
export async function fetchFollowedArtistsPage(
  cursor: string | null,
  { limit, signal }: { limit: number; signal?: AbortSignal },
): Promise<{ items: ArtistSummary[]; next: string | null }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("after", cursor);

  const page = await getJson<FollowedArtistsPage>(
    `/api/spotify/following?${params}`,
    { signal, service: SERVICE },
  );
  return { items: page.items.map(toArtistSummary), next: page.nextCursor };
}

/** Every playlist, walking the offset pagination of `/api/spotify/playlists`. */
export async function fetchAllUserPlaylists(
  signal?: AbortSignal,
): Promise<PlaylistSummary[]> {
  const playlists = await walkPages<PlaylistsPage, SpotifyPlaylist>({
    service: SERVICE,
    signal,
    pageUrl: (offset) => `/api/spotify/playlists?offset=${offset ?? 0}`,
    getItems: (page) => page.items,
    getNext: (page) =>
      page.nextOffset === null ? null : String(page.nextOffset),
    getKey: (playlist) => playlist.id,
  });
  return playlists.map(toPlaylistSummary);
}

/** Every track of one playlist, walking the offset pagination. */
export function fetchAllPlaylistTracks(
  playlistId: string,
  signal?: AbortSignal,
): Promise<ExportedTrack[]> {
  return walkPages<PlaylistTracksPage, ExportedTrack>({
    service: SERVICE,
    signal,
    pageUrl: (offset) =>
      `/api/spotify/playlists/${encodeURIComponent(playlistId)}/tracks?offset=${offset ?? 0}`,
    getItems: (page) => page.items,
    getNext: (page) =>
      page.nextOffset === null ? null : String(page.nextOffset),
  });
}

/* ------------------------------------------------------------------ */
/* Writing (YouTube Music -> Spotify copy)                             */
/* ------------------------------------------------------------------ */

export type SpotifyTrackMatch = {
  uri: string;
  name: string;
  artists: string[];
  confidence: "high" | "low";
};

export async function createSpotifyPlaylist(input: {
  title: string;
  description?: string;
  privacyStatus: "private" | "public";
}): Promise<{ id: string; title: string }> {
  const created = await sendJson<{ id: string; title: string }>(
    "/api/spotify/playlists",
    { method: "POST", body: input, service: SERVICE },
  );
  if (!created) throw new Error("Spotify did not return the new playlist");
  return created;
}

export async function matchTrackOnSpotify(
  track: { name: string; artists: string[]; durationMs?: number },
  signal?: AbortSignal,
): Promise<SpotifyTrackMatch | null> {
  const result = await sendJson<{ match: SpotifyTrackMatch | null }>(
    "/api/spotify/match",
    { method: "POST", body: track, service: SERVICE, signal },
  );
  return result?.match ?? null;
}

export async function addTracksToSpotifyPlaylist(
  playlistId: string,
  uris: string[],
  signal?: AbortSignal,
): Promise<void> {
  await sendJson(`/api/spotify/playlists/${encodeURIComponent(playlistId)}/items`, {
    method: "POST",
    body: { uris },
    service: SERVICE,
    signal,
  });
}

export async function removeTracksFromSpotifyPlaylist(
  playlistId: string,
  uris: string[],
): Promise<void> {
  await sendJson(`/api/spotify/playlists/${encodeURIComponent(playlistId)}/items`, {
    method: "DELETE",
    body: { uris },
    service: SERVICE,
  });
}

/** Every track URI already in a playlist. */
export function fetchSpotifyPlaylistUris(
  playlistId: string,
  signal?: AbortSignal,
): Promise<string[]> {
  return walkPages<{ uris: string[]; nextOffset: number | null }, string>({
    service: SERVICE,
    signal,
    pageUrl: (offset) =>
      `/api/spotify/playlists/${encodeURIComponent(playlistId)}/items?offset=${offset ?? 0}`,
    getItems: (page) => page.uris,
    getNext: (page) => (page.nextOffset === null ? null : String(page.nextOffset)),
  });
}

export function lookupSpotifyTrack(
  id: string,
): Promise<{ uri: string; name: string; artists: string[] }> {
  return getJson(`/api/spotify/tracks/${encodeURIComponent(id)}`, {
    service: SERVICE,
  });
}

export function spotifyPlaylistUrl(playlistId: string) {
  return `https://open.spotify.com/playlist/${encodeURIComponent(playlistId)}`;
}

/** Web link for a `spotify:track:<id>` URI. */
export function spotifyTrackUrl(uri: string) {
  return `https://open.spotify.com/track/${encodeURIComponent(uri.split(":").pop() ?? "")}`;
}

export type FollowResult = { name: string; url: string; imageUrl: string | null };

/** Follows an artist on Spotify by name (searches first). */
export async function followArtistOnSpotify(
  name: string,
): Promise<FollowResult> {
  const result = await sendJson<FollowResult>("/api/spotify/follow", {
    method: "POST",
    body: { name },
    service: SERVICE,
  });
  if (!result) throw new Error("Spotify did not confirm the follow");
  return result;
}

/**
 * Browser-side fetchers for YouTube Music. They walk our own `/api/youtube/*`
 * routes and map the results into the provider-neutral shapes in `@/lib/music`.
 */

import { walkPages } from "@/lib/api-client";
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
const MUSIC_BASE = "https://music.youtube.com";

function withToken(path: string, token: string | null) {
  return token ? `${path}?pageToken=${encodeURIComponent(token)}` : path;
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
    url: playlist.isLikes
      ? `https://www.youtube.com/playlist?list=${encodeURIComponent(playlist.id)}`
      : `${MUSIC_BASE}/playlist?list=${encodeURIComponent(playlist.id)}`,
  };
}

/** Every subscribed artist channel. Name dedupe happens in `sortYouTubeArtists`. */
export async function fetchAllYouTubeArtists(
  signal?: AbortSignal,
): Promise<ArtistSummary[]> {
  let scanned = 0;
  let total: number | null = null;

  const artists = await walkPages<YouTubeArtistsPage, YouTubeArtist>({
    service: SERVICE,
    signal,
    pageUrl: (token) => withToken("/api/youtube/artists", token),
    getItems: (page) => {
      scanned += page.scanned;
      total = page.totalSubscriptions ?? total;
      return page.items;
    },
    getNext: (page) => page.nextPageToken,
    getKey: (artist) => artist.id,
  });

  console.info(
    `[youtube] ${artists.length} artist channels out of ${scanned} subscriptions scanned (YouTube reports ${total ?? "?"}).`,
  );
  if (total !== null && scanned < total) {
    console.warn(
      "[youtube] Pagination ended before every subscription was scanned.",
    );
  }

  return artists.map(toArtistSummary);
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

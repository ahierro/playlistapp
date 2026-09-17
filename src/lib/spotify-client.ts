/**
 * Browser-side fetchers for Spotify. They walk our own `/api/spotify/*` routes
 * and map the Spotify objects into the provider-neutral shapes in `@/lib/music`.
 */

import { walkPages } from "@/lib/api-client";
import {
  pickImage,
  type ArtistSummary,
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

/** Every followed artist, walking the cursor pagination of `/api/spotify/following`. */
export async function fetchAllFollowedArtists(
  signal?: AbortSignal,
): Promise<ArtistSummary[]> {
  const artists = await walkPages<FollowedArtistsPage, SpotifyArtist>({
    service: SERVICE,
    signal,
    pageUrl: (after) =>
      `/api/spotify/following${after ? `?after=${encodeURIComponent(after)}` : ""}`,
    getItems: (page) => page.items,
    getNext: (page) => page.nextCursor,
    getKey: (artist) => artist.id,
  });
  return artists.map(toArtistSummary);
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

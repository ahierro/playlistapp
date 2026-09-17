/**
 * Everything the shared list components need to know about a service, in one
 * place. Client-safe: it only references browser fetchers and pure helpers.
 */

import { Disc3, type LucideIcon, Music } from "lucide-react";

import {
  sortByName,
  type ArtistSummary,
  type ExportedTrack,
  type MusicService,
  type PlaylistSummary,
} from "@/lib/music";
import {
  fetchAllFollowedArtists,
  fetchAllPlaylistTracks,
  fetchAllUserPlaylists,
} from "@/lib/spotify-client";
import { stripSpotifyEditionNoise } from "@/lib/spotify-title-cleaner";
import {
  fetchAllYouTubeArtists,
  fetchAllYouTubePlaylists,
  fetchAllYouTubePlaylistTracks,
} from "@/lib/youtube-client";

export type ServiceConfig = {
  id: MusicService;
  label: string;
  icon: LucideIcon;
  /** Route prefix of the service's pages. */
  basePath: string;
  artists: {
    cacheKey: string;
    fetchAll: (signal?: AbortSignal) => Promise<ArtistSummary[]>;
    sort: (items: ArtistSummary[]) => ArtistSummary[];
    exportUrl: string;
    exportFilePrefix: string;
    nounPlural: string;
    emptyMessage: string;
  };
  playlists: {
    cacheKey: string;
    fetchAll: (signal?: AbortSignal) => Promise<PlaylistSummary[]>;
    sort: (items: PlaylistSummary[]) => PlaylistSummary[];
    fetchTracks: (id: string, signal?: AbortSignal) => Promise<ExportedTrack[]>;
    /** Whether the service will hand over the playlist's contents. */
    isReadable: (playlist: PlaylistSummary, userId: string) => boolean;
    exportFilePrefix: string;
  };
};

/**
 * "Adele" and "Adele - Topic" both map to "Adele": keep one, merging genres.
 * Sorting first means the kept entry is deterministic.
 */
function sortYouTubeArtists(artists: ArtistSummary[]): ArtistSummary[] {
  const byName = new Map<string, ArtistSummary>();

  for (const artist of sortByName(artists)) {
    const key = artist.name.normalize("NFKD").toLowerCase().trim();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, artist);
      continue;
    }
    byName.set(key, {
      ...existing,
      imageUrl: existing.imageUrl ?? artist.imageUrl,
      genres: [...new Set([...existing.genres, ...artist.genres])],
    });
  }

  return [...byName.values()];
}

/** Liked videos first, then alphabetical. */
function sortYouTubePlaylists(playlists: PlaylistSummary[]): PlaylistSummary[] {
  const sorted = sortByName(playlists);
  const likes = sorted.findIndex((playlist) => playlist.id === "LL");
  if (likes > 0) sorted.unshift(...sorted.splice(likes, 1));
  return sorted;
}

export const SERVICES: Record<MusicService, ServiceConfig> = {
  spotify: {
    id: "spotify",
    label: "Spotify",
    icon: Disc3,
    basePath: "",
    artists: {
      cacheKey: "followed-artists",
      fetchAll: fetchAllFollowedArtists,
      sort: sortByName,
      exportUrl: "/api/spotify/following/export",
      exportFilePrefix: "followed-artists",
      nounPlural: "artists",
      emptyMessage: "You do not follow any artists yet.",
    },
    playlists: {
      cacheKey: "playlists",
      fetchAll: fetchAllUserPlaylists,
      sort: sortByName,
      fetchTracks: fetchAllPlaylistTracks,
      // Since February 2026 Spotify only exposes the contents of playlists the
      // user owns or collaborates on.
      isReadable: (playlist, userId) =>
        playlist.ownerId === userId || playlist.collaborative,
      exportFilePrefix: "playlists",
    },
  },
  "youtube-music": {
    id: "youtube-music",
    label: "YouTube Music",
    icon: Music,
    basePath: "/youtube-music",
    artists: {
      cacheKey: "yt-artists",
      fetchAll: fetchAllYouTubeArtists,
      sort: sortYouTubeArtists,
      exportUrl: "/api/youtube/artists/export",
      exportFilePrefix: "youtube-music-artists",
      nounPlural: "artists",
      emptyMessage:
        "None of your YouTube subscriptions look like an artist channel.",
    },
    playlists: {
      cacheKey: "yt-playlists",
      fetchAll: fetchAllYouTubePlaylists,
      sort: sortYouTubePlaylists,
      fetchTracks: fetchAllYouTubePlaylistTracks,
      // The API only lists the user's own playlists (`mine=true`).
      isReadable: () => true,
      exportFilePrefix: "youtube-music-playlists",
    },
  },
};

/** Spotify titles carry "Remastered 2009"-style noise; the cleaner is safe for YouTube too. */
export function cleanExportedTrack(track: ExportedTrack): ExportedTrack {
  return {
    ...track,
    name: stripSpotifyEditionNoise(track.name),
    album: track.album === null ? null : stripSpotifyEditionNoise(track.album),
  };
}

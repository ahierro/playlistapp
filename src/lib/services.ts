/**
 * Everything the shared list components need to know about a service, in one
 * place. Client-safe: it only references browser fetchers and pure helpers.
 */

import type { ComponentType } from "react";

import { SpotifyLogo, YouTubeMusicLogo } from "@/components/service-logo";

import {
  sortByName,
  type ArtistSummary,
  type DownloadProgress,
  type ExportedTrack,
  type MusicService,
  type PlaylistSummary,
} from "@/lib/music";
import {
  fetchAllFollowedArtists,
  fetchFollowedArtistsPage,
  fetchAllPlaylistTracks,
  fetchAllUserPlaylists,
} from "@/lib/spotify-client";
import { stripSpotifyEditionNoise } from "@/lib/spotify-title-cleaner";
import {
  fetchAllYouTubeArtists,
  fetchYouTubeArtistsPage,
  fetchAllYouTubePlaylists,
  fetchAllYouTubePlaylistTracks,
} from "@/lib/youtube-client";

export type ServiceConfig = {
  id: MusicService;
  label: string;
  /** Official logo; takes a `className` like a lucide icon. */
  icon: ComponentType<{ className?: string }>;
  /** Class that switches the accent color to the brand's (see globals.css). */
  themeClass: string;
  /** Route prefix of the service's pages. */
  basePath: string;
  artists: {
    /**
     * One remote page, for the infinite scroll. It may hold fewer items than
     * `limit` (YouTube filters subscriptions down to artists).
     */
    fetchPage: (
      cursor: string | null,
      options: { limit: number; signal?: AbortSignal },
    ) => Promise<{ items: ArtistSummary[]; next: string | null }>;
    /** Server route that walks EVERY page and answers a .txt. */
    /**
     * The complete list, walking every page and reporting progress. Only used
     * by the download button.
     */
    fetchAll: (options?: {
      signal?: AbortSignal;
      onProgress?: (progress: DownloadProgress) => void;
    }) => Promise<ArtistSummary[]>;
    /** localStorage cache name for the complete list. */
    fullCacheKey: string;
    /** Sorting for the complete list (the .txt is alphabetical). */
    sort: (items: ArtistSummary[]) => ArtistSummary[];
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
    icon: SpotifyLogo,
    themeClass: "",
    basePath: "",
    artists: {
      fetchPage: fetchFollowedArtistsPage,
      fetchAll: fetchAllFollowedArtists,
      fullCacheKey: "followed-artists-full",
      sort: sortByName,
      exportFilePrefix: "spotify-followed-artists",
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
    icon: YouTubeMusicLogo,
    themeClass: "theme-youtube",
    basePath: "/youtube-music",
    artists: {
      fetchPage: fetchYouTubeArtistsPage,
      fetchAll: fetchAllYouTubeArtists,
      fullCacheKey: "yt-artists-full",
      sort: sortYouTubeArtists,
      exportFilePrefix: "youtube-music-followed-artists",
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

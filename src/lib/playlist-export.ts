import type { ExportedTrack, SpotifyPlaylist } from "@/lib/spotify";
import { fetchAllPlaylistTracks, MissingScopeError } from "@/lib/spotify-client";
import { stripSpotifyEditionNoise } from "@/lib/spotify-title-cleaner";

export type ExportedPlaylist = {
  id: string;
  name: string;
  owner: string | null;
  url: string;
  trackCount: number;
  tracks: ExportedTrack[];
  /**
   * Set when Spotify refused to hand over the contents. Since February 2026 that
   * happens for every playlist the user neither owns nor collaborates on, whatever
   * scopes the token has, so the entry keeps the playlist's metadata and an empty
   * track list rather than disappearing from the file.
   */
  unreadable?: true;
};

export type PlaylistExport = {
  exportedAt: string;
  playlistCount: number;
  trackCount: number;
  /** How many playlists Spotify would not let us read. */
  unreadableCount: number;
  playlists: ExportedPlaylist[];
};

export type ExportProgress = {
  /** Playlists already fetched. */
  done: number;
  total: number;
  /** Name of the playlist being fetched right now. */
  current: string;
  /** Playlists Spotify refused so far. */
  unreadable: number;
};

/**
 * Walks every playlist and collects its tracks into one object ready to be
 * serialized.
 *
 * One playlist at a time, on purpose: a playlist can be several pages long, and
 * firing them all at once is the fastest way to a 429. Sequential also keeps the
 * progress counter meaningful.
 */
export async function buildPlaylistExport(
  playlists: SpotifyPlaylist[],
  {
    signal,
    onProgress,
  }: {
    signal?: AbortSignal;
    onProgress?: (progress: ExportProgress) => void;
  } = {},
): Promise<PlaylistExport> {
  const exported: ExportedPlaylist[] = [];
  let trackCount = 0;
  let unreadable = 0;

  for (const [index, playlist] of playlists.entries()) {
    if (signal?.aborted) {
      throw new DOMException("The export was cancelled", "AbortError");
    }

    onProgress?.({
      done: index,
      total: playlists.length,
      current: playlist.name,
      unreadable,
    });

    const entry: ExportedPlaylist = {
      id: playlist.id,
      name: playlist.name,
      owner: playlist.owner.display_name ?? null,
      url: playlist.external_urls.spotify,
      trackCount: 0,
      tracks: [],
    };

    try {
      const tracks = await fetchAllPlaylistTracks(playlist.id, signal);
      entry.tracks = tracks.map((track) => ({
        ...track,
        name: stripSpotifyEditionNoise(track.name),
        album:
          track.album === null
            ? null
            : stripSpotifyEditionNoise(track.album),
      }));
      entry.trackCount = entry.tracks.length;
      trackCount += entry.trackCount;
    } catch (cause) {
      // 403 on a single playlist is expected, not a failure of the whole export.
      if (!(cause instanceof MissingScopeError)) throw cause;
      entry.unreadable = true;
      unreadable++;
    }

    exported.push(entry);
  }

  onProgress?.({
    done: playlists.length,
    total: playlists.length,
    current: "",
    unreadable,
  });

  return {
    exportedAt: new Date().toISOString(),
    playlistCount: exported.length,
    trackCount,
    unreadableCount: unreadable,
    playlists: exported,
  };
}

/** Hands the browser a .json file, with no round trip to the server. */
export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

import type { ExportedTrack, MusicService, PlaylistSummary } from "@/lib/music";
import { MissingScopeError } from "@/lib/api-client";
import { cleanExportedTrack } from "@/lib/services";

export type ExportedPlaylist = {
  id: string;
  name: string;
  owner: string | null;
  url: string;
  trackCount: number;
  tracks: ExportedTrack[];
  /**
   * Set when the service refused to hand over the contents (Spotify does that for
   * every playlist the user neither owns nor collaborates on). The entry keeps the
   * playlist's metadata and an empty track list rather than disappearing.
   */
  unreadable?: true;
};

export type PlaylistExport = {
  service: MusicService;
  exportedAt: string;
  playlistCount: number;
  trackCount: number;
  /** How many playlists the service would not let us read. */
  unreadableCount: number;
  playlists: ExportedPlaylist[];
};

export type ExportProgress = {
  /** Playlists already fetched. */
  done: number;
  total: number;
  /** Name of the playlist being fetched right now. */
  current: string;
  /** Playlists refused so far. */
  unreadable: number;
};

/**
 * Walks every playlist and collects its tracks into one object ready to be
 * serialized.
 *
 * One playlist at a time, on purpose: a playlist can be several pages long, and
 * firing them all at once is the fastest way to a rate limit. Sequential also
 * keeps the progress counter meaningful.
 */
export async function buildPlaylistExport(
  playlists: PlaylistSummary[],
  {
    service,
    fetchTracks,
    signal,
    onProgress,
  }: {
    service: MusicService;
    fetchTracks: (id: string, signal?: AbortSignal) => Promise<ExportedTrack[]>;
    signal?: AbortSignal;
    onProgress?: (progress: ExportProgress) => void;
  },
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
      owner: playlist.ownerName,
      url: playlist.url,
      trackCount: 0,
      tracks: [],
    };

    try {
      const tracks = await fetchTracks(playlist.id, signal);
      entry.tracks = tracks.map(cleanExportedTrack);
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
    service,
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

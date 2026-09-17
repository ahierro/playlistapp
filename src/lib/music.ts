/**
 * Provider-neutral shapes the UI works with. Each service (Spotify, YouTube
 * Music) maps its own API objects into these on the client, so the cards, lists
 * and the JSON export are shared.
 */

export type MusicService = "spotify" | "youtube-music";

export const SERVICE_LABELS: Record<MusicService, string> = {
  spotify: "Spotify",
  "youtube-music": "YouTube Music",
};

export type ArtistSummary = {
  id: string;
  name: string;
  genres: string[];
  imageUrl: string | null;
  url: string;
  /** Spotify only, and only when the account still receives it. */
  followers?: number;
};

export type PlaylistSummary = {
  id: string;
  name: string;
  ownerId: string | null;
  ownerName: string | null;
  collaborative: boolean;
  /** null when the service does not say. */
  isPublic: boolean | null;
  imageUrl: string | null;
  trackCount: number | null;
  url: string;
  /**
   * YouTube only: whether the playlist looks like music (see `getMusicShare`).
   * Undefined for services where every playlist is music.
   */
  isMusic?: boolean;
};

/**
 * One entry of a playlist, flattened to what the JSON export needs.
 * Podcast episodes have no artists or album, so they carry `type: "episode"` and
 * borrow the show for those fields rather than pretending to be songs.
 */
export type ExportedTrack = {
  name: string;
  artists: string[];
  album: string | null;
  type?: "episode";
  /**
   * Used to match the track on YouTube. Not written to the JSON export
   * (`buildPlaylistExport` drops it).
   */
  durationMs?: number;
};

/** One page of a playlist's contents, as our API routes return it. */
export type TracksPage = {
  items: ExportedTrack[];
  /** Offset (Spotify) or page token (YouTube) of the next page. null at the end. */
  next: string | null;
};

/**
 * Alphabetical ordering with `Intl.Collator`: it handles accents and case the way
 * a person would, and sorts embedded numbers by value ("Artist 2" before "Artist 10").
 */
export const nameCollator = new Intl.Collator("en", {
  sensitivity: "base",
  numeric: true,
});

export function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => nameCollator.compare(a.name, b.name));
}

/** The smallest image that reaches the requested size (to avoid downloading 640px for nothing). */
export function pickImage<
  T extends { url: string; width?: number | null; height?: number | null },
>(images: T[] | null | undefined, minSize = 160): T | undefined {
  const sorted = [...(images ?? [])].sort(
    (a, b) => (a.width ?? 0) - (b.width ?? 0),
  );
  return sorted.find((image) => (image.width ?? 0) >= minSize) ?? sorted.at(-1);
}

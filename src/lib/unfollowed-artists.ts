/**
 * Counts the artists behind the songs you keep, and drops the ones you already
 * follow.
 *
 * Every credit on every song is one appearance, features included: an artist
 * you have ten songs of is a stronger suggestion than one you have a single
 * guest verse from, and the count is what the list is sorted by.
 *
 * Artists are told apart by their Spotify id, never by name. The same artist is
 * spelled differently across tracks, and different artists share names, so ids
 * are the only thing worth matching on here.
 *
 * Kept free of imports so `node --test` can load it directly.
 */

export type ArtistCredit = {
  id: string;
  name: string;
  uri: string;
  url: string;
};

/** A credit together with where it was found ("Liked songs", a playlist name). */
export type SourcedCredit = { artist: ArtistCredit; source: string };

export type UnfollowedArtist = ArtistCredit & {
  /** Songs of yours this artist is credited on. */
  trackCount: number;
  /** Where those songs are, most songs first. */
  sources: { name: string; count: number }[];
};

/**
 * Spotify's placeholder for compilations. It behaves like an artist in the API
 * but following it is meaningless.
 */
const IGNORED_ARTIST_IDS = new Set([
  // Various Artists
  "0LyfQWJT6nXafLPZqxe9Of",
]);

/**
 * The artists credited on `credits` that are not in `followedIds`, counted and
 * ordered by how many of your songs they appear on.
 *
 * The same artist credited twice on one song would be counted twice, so callers
 * pass one credit per artist per song.
 */
export function tallyUnfollowedArtists(
  credits: SourcedCredit[],
  followedIds: Iterable<string>,
): UnfollowedArtist[] {
  const followed = new Set(followedIds);
  const found = new Map<
    string,
    UnfollowedArtist & { bySource: Map<string, number> }
  >();

  for (const { artist, source } of credits) {
    if (!artist.id || followed.has(artist.id) || IGNORED_ARTIST_IDS.has(artist.id)) {
      continue;
    }

    let entry = found.get(artist.id);
    if (!entry) {
      entry = { ...artist, trackCount: 0, sources: [], bySource: new Map() };
      found.set(artist.id, entry);
    }

    entry.trackCount++;
    entry.bySource.set(source, (entry.bySource.get(source) ?? 0) + 1);
  }

  const artists = [...found.values()].map(({ bySource, ...artist }) => ({
    ...artist,
    sources: [...bySource.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  }));

  return artists.sort(
    (a, b) => b.trackCount - a.trackCount || a.name.localeCompare(b.name),
  );
}

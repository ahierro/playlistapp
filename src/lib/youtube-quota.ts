/**
 * What a copy costs against YouTube's quota, and how long it will take.
 *
 * Since 1 June 2026 the YouTube Data API charges `search.list` and
 * `videos.insert` to quota buckets of their own instead of taking them out of
 * one pool. A project gets, per day:
 *
 * - 100 `search.list` calls,
 * - 100 `videos.insert` calls (this app never uploads),
 * - 10,000 units for everything else.
 *
 * That changes what limits a copy. Under the old single pool a song cost 151
 * units and the day ran out after ~66 songs. Now the search is what runs out
 * first: one call per song, so about 100 songs a day, while the same songs only
 * spend ~5,100 of the 10,000 general units. A song whose match is already
 * cached needs no search at all, so a resumed copy is bound by the general
 * bucket instead and gets much further.
 *
 * Kept free of imports so `node --test` can load it directly.
 */

export type CopyDirection = "spotify-to-youtube" | "youtube-to-spotify";

/** `search.list` calls a project may make per day. */
export const DAILY_SEARCH_CALLS = 100;
/** Units per day for every other method. */
export const DAILY_GENERAL_UNITS = 10_000;

/** Per-method costs, for the estimates below. */
const SEARCH_CALLS_PER_TRACK = 1;
/** `videos.list` for the candidates' durations (1) + `playlistItems.insert` (50). */
const GENERAL_UNITS_PER_TRACK = 51;
/** `playlists.insert`. */
const GENERAL_UNITS_PER_NEW_PLAYLIST = 50;
/** `playlistItems.list` + `videos.list`, per page of 50 songs read. */
const GENERAL_UNITS_PER_READ_PAGE = 2;

export type QuotaEstimate = {
  /** `search.list` calls, against the 100 a day. */
  search: number;
  /** Units against the 10,000 a day. */
  general: number;
};

/**
 * What a copy needs at worst. Spotify -> YouTube searches and inserts every
 * song; YouTube -> Spotify only reads the source playlist, and the writing
 * happens on Spotify, which has no daily quota.
 */
export function estimateQuota(
  direction: CopyDirection,
  trackCount: number,
  newPlaylists: number,
): QuotaEstimate {
  if (direction === "youtube-to-spotify") {
    return {
      search: 0,
      general:
        Math.ceil(trackCount / 50) * GENERAL_UNITS_PER_READ_PAGE +
        // Reading the ids already in the target playlist.
        1,
    };
  }

  return {
    search: trackCount * SEARCH_CALLS_PER_TRACK,
    general:
      trackCount * GENERAL_UNITS_PER_TRACK +
      newPlaylists * GENERAL_UNITS_PER_NEW_PLAYLIST,
  };
}

export type QuotaForecast = {
  /** Days the copy will span, 1 when it fits in what is left of today. */
  days: number;
  /** The bucket that runs out first, or null when nothing is spent. */
  limitedBy: "search" | "general" | null;
};

/** How long a copy will take, set by whichever bucket it drains fastest. */
export function forecastQuota(estimate: QuotaEstimate): QuotaForecast {
  const searchDays = estimate.search / DAILY_SEARCH_CALLS;
  const generalDays = estimate.general / DAILY_GENERAL_UNITS;

  if (searchDays === 0 && generalDays === 0) {
    return { days: 1, limitedBy: null };
  }

  return {
    days: Math.max(1, Math.ceil(Math.max(searchDays, generalDays))),
    limitedBy: searchDays >= generalDays ? "search" : "general",
  };
}

/** Songs a fresh day's quota covers, for "about N a day" in the UI. */
export function tracksPerDay(direction: CopyDirection): number {
  const { search, general } = estimateQuota(direction, 1, 0);
  const bySearch = search > 0 ? DAILY_SEARCH_CALLS / search : Infinity;
  const byGeneral = general > 0 ? DAILY_GENERAL_UNITS / general : Infinity;
  return Math.floor(Math.min(bySearch, byGeneral));
}

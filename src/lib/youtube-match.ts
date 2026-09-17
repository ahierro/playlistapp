/**
 * Picks the YouTube video that best matches a Spotify track.
 *
 * Search results are scored on what the Data API gives us: the video title, the
 * uploader channel and the duration. Kept free of imports so `node --test` can
 * load it directly.
 */

export type MatchQuery = {
  name: string;
  artists: string[];
  durationMs?: number | null;
};

export type VideoCandidate = {
  videoId: string;
  title: string;
  channelTitle: string;
  durationSeconds: number | null;
};

export type Confidence = "high" | "low";

export type ScoredCandidate = VideoCandidate & {
  score: number;
  confidence: Confidence;
};

/** Words that mark a different recording than the studio track. */
const VARIANT_WORDS = [
  "live",
  "en vivo",
  "acoustic",
  "acustico",
  "cover",
  "karaoke",
  "instrumental",
  "remix",
  "sped up",
  "slowed",
  "reverb",
  "8d",
  "nightcore",
  "tutorial",
  "reaction",
  "lesson",
];

const MIN_SCORE = 3;
const HIGH_CONFIDENCE_SCORE = 6;

/** Lowercase, no accents, no punctuation, single spaces. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The part of a track name that must appear in the video title.
 * "Song (feat. X) - Remastered 2011" -> "song".
 */
export function coreTitle(name: string): string {
  const base = name
    .replace(/\s*[([].*?[)\]]/g, "")
    .replace(/\s+-\s+.*$/, "");
  return normalizeText(base) || normalizeText(name);
}

function containsWords(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

export function buildSearchQuery(query: MatchQuery): string {
  const artist = query.artists[0] ?? "";
  return `${artist} ${query.name}`.trim();
}

export function scoreCandidate(
  query: MatchQuery,
  candidate: VideoCandidate,
): number {
  const title = normalizeText(candidate.title);
  const channel = normalizeText(candidate.channelTitle);
  const wanted = coreTitle(query.name);
  const artists = query.artists.map(normalizeText).filter(Boolean);
  const isTopic = /\stopic$/.test(channel);
  const channelArtist = channel.replace(/\s(topic|vevo)$/, "").replace(/vevo$/, "");

  let score = 0;

  if (containsWords(title, wanted)) score += 3;
  else if (wanted.split(" ").every((word) => containsWords(title, word))) score += 1;
  else score -= 3;

  const artistInChannel = artists.some(
    (artist) => channelArtist === artist || containsWords(channel, artist),
  );
  const artistInTitle = artists.some((artist) => containsWords(title, artist));
  if (artistInChannel) score += 3;
  else if (artistInTitle) score += 1;
  else score -= 2;

  // Auto-generated "Artist - Topic" uploads are the album recordings YouTube Music plays.
  if (isTopic && artistInChannel) score += 2;
  if (/vevo$/.test(channel.replace(/\s/g, "")) && artistInChannel) score += 1;

  const wantedText = normalizeText(query.name);
  for (const word of VARIANT_WORDS) {
    if (containsWords(title, word) && !containsWords(wantedText, word)) {
      score -= 3;
      break;
    }
  }

  if (query.durationMs && candidate.durationSeconds !== null) {
    const diff = Math.abs(query.durationMs / 1000 - candidate.durationSeconds);
    if (diff <= 3) score += 2;
    else if (diff <= 10) score += 1;
    else if (diff > 30) score -= 3;
  }

  return score;
}

/** Best candidate, or null when nothing is a plausible match. */
export function pickBestMatch(
  query: MatchQuery,
  candidates: VideoCandidate[],
): ScoredCandidate | null {
  let best: ScoredCandidate | null = null;

  candidates.forEach((candidate, index) => {
    // Small bonus for YouTube's own ranking, enough to break ties only.
    const score = scoreCandidate(query, candidate) - index * 0.1;
    if (!best || score > best.score) {
      best = {
        ...candidate,
        score,
        confidence: score >= HIGH_CONFIDENCE_SCORE ? "high" : "low",
      };
    }
  });

  const chosen = best as ScoredCandidate | null;
  return chosen && chosen.score >= MIN_SCORE ? chosen : null;
}

/** ISO 8601 duration ("PT3M25S") to seconds. */
export function parseIsoDuration(value: string | null | undefined): number | null {
  const match = value?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  const [, d, h, m, s] = match.map((part) => Number(part ?? 0));
  return d * 86400 + h * 3600 + m * 60 + s;
}

/** Video id from a YouTube / YouTube Music URL, or a bare id. */
export function parseVideoId(input: string): string | null {
  const value = input.trim();
  if (/^[\w-]{11}$/.test(value)) return value;

  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.slice(1, 12);
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host === "youtube.com" || host === "music.youtube.com") {
      const id =
        url.searchParams.get("v") ??
        url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/)?.[1] ??
        null;
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
  } catch {
    return null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Artist channels                                                     */
/* ------------------------------------------------------------------ */

/** YouTube's "Music" video category. */
export const MUSIC_CATEGORY_ID = "10";

/** Recent uploads looked at per channel. */
export const ARTIST_SAMPLE_SIZE = 10;
/** Share of Music-category uploads from which a channel counts as an artist. */
export const ARTIST_MUSIC_SHARE = 0.6;
/** Below this many uploads the sample says nothing. */
const MIN_SAMPLE = 3;
/**
 * Longer uploads are not songs (vlogs, podcasts, reviews, live streams), even
 * when filed under Music. Judged per video: one concert or full album does not
 * disqualify an artist, it just does not count as music.
 */
export const MAX_SONG_SECONDS = 10 * 60;

export type UploadSample = {
  categoryId: string;
  /** null when YouTube did not report it. */
  durationSeconds: number | null;
};

/** A Music-category upload no longer than a song can be. */
export function isSongLike(upload: UploadSample): boolean {
  return (
    upload.categoryId === MUSIC_CATEGORY_ID &&
    (upload.durationSeconds === null || upload.durationSeconds <= MAX_SONG_SECONDS)
  );
}

/**
 * Decides whether a subscribed channel is an artist.
 *
 * - "Name - Topic" and "NameVEVO" channels always are.
 * - Otherwise YouTube must have tagged the channel with a music topic AND most
 *   of its recent uploads must be song-like: in the Music category and no longer
 *   than 10 minutes. The topic alone lets in reviewers, reaction and gear
 *   channels, which talk about music but upload long "Entertainment" or
 *   "People & Blogs" videos.
 * - A channel with too few uploads to judge is kept only when YouTube tagged it
 *   with a specific genre, not just the generic "Music".
 *
 * `uploads` is null when the uploads were not looked at.
 */
export function isArtistChannel(
  title: string,
  topics: string[],
  uploads: UploadSample[] | null = null,
): boolean {
  if (/\s-\s+topic$/iu.test(title) || /vevo$/iu.test(title)) return true;

  const musicTopics = topics.filter((topic) => MUSIC_TOPIC_NAMES.has(topic));
  if (musicTopics.length === 0) return false;
  if (uploads === null) return true;

  if (uploads.length < MIN_SAMPLE) {
    return musicTopics.some((topic) => topic !== "Music");
  }

  const songs = uploads.filter(isSongLike).length;
  return songs / uploads.length >= ARTIST_MUSIC_SHARE;
}

/** Whether the uploads have to be checked at all (saves quota on obvious cases). */
export function needsUploadCheck(title: string, topics: string[]): boolean {
  if (/\s-\s+topic$/iu.test(title) || /vevo$/iu.test(title)) return false;
  return topics.some((topic) => MUSIC_TOPIC_NAMES.has(topic));
}

/**
 * Freebase topics YouTube assigns to music channels, as the last part of their
 * Wikipedia URLs. https://developers.google.com/youtube/v3/docs/channels#topicDetails
 */
export const MUSIC_TOPIC_NAMES = new Set([
  "Music",
  "Christian_music",
  "Classical_music",
  "Country_music",
  "Electronic_music",
  "Hip_hop_music",
  "Independent_music",
  "Jazz",
  "Music_of_Asia",
  "Music_of_Latin_America",
  "Pop_music",
  "Reggae",
  "Rhythm_and_blues",
  "Rock_music",
  "Soul_music",
]);

/** Track id from an open.spotify.com link, a spotify:track: URI or a bare id. */
export function parseSpotifyTrackId(input: string): string | null {
  const value = input.trim();
  if (/^[A-Za-z0-9]{22}$/.test(value)) return value;

  const uri = value.match(/^spotify:track:([A-Za-z0-9]{22})$/);
  if (uri) return uri[1];

  try {
    const url = new URL(value);
    if (url.hostname !== "open.spotify.com") return null;
    // Also "/intl-es/track/<id>".
    const match = url.pathname.match(/\/track\/([A-Za-z0-9]{22})(?:\/|$)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

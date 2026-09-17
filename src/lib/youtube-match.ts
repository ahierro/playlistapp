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

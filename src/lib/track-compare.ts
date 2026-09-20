/**
 * Compares the contents of two playlists to find which songs are in both and
 * which are only in one of them.
 *
 * The two services share nothing but titles and artist names, so songs are
 * matched loosely: case, accents and punctuation are ignored, the qualifiers
 * Spotify and YouTube tack on are dropped ("(feat. X)", "- Remastered 2011",
 * "(Official Video)"), and a leading "The" is removed from artist names.
 *
 * Songs are paired in three passes, strongest evidence first:
 *
 * 1. Same title and at least one artist in common.
 * 2. Every word of one song's artist + title appears in the other's. YouTube
 *    uploads cram everything into the video title in any order and add their
 *    own noise, so "Ghost — Lachryma" and "Stella BC — Lachryma // Ghost //
 *    Music Video [Sub Español]" only meet this way.
 * 3. Same title but no artist in common. That is where a cover, a different
 *    band's song of the same name, or a badly parsed YouTube title shows up,
 *    so those are reported separately as possible matches.
 *
 * Kept free of imports so `node --test` can load it directly.
 */

export type ComparableTrack = {
  name: string;
  artists: string[];
};

/** Lowercase, no accents, no punctuation, single spaces. */
function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Words channels and labels add to an artist name. */
const ARTIST_NOISE =
  /\s+(?:official|oficial|officiel|music|musica|música|tv|channel|canal|vevo|topic|records|band)$/iu;

/** Separators services use to cram several artists into one string. */
const ARTIST_SPLIT = /\s*(?:,|;|\/|·|&|\+|\bfeat\.?\b|\bft\.?\b|\bwith\b|\bx\b)\s*/iu;

/**
 * The part of a title that identifies the song: everything before the first
 * bracket or dash. "Song (feat. X) - Remastered 2011" -> "song".
 */
export function titleKey(name: string): string {
  const base = name
    .replace(/\s*[([{].*$/u, "")
    .replace(/\s+[-–—|]\s+.*$/u, "");
  return normalize(base) || normalize(name);
}

/** One key per artist, so "Calamaro, Charly" and "Charly García" still meet. */
export function artistKeys(artists: string[]): string[] {
  const keys = new Set<string>();

  for (const raw of artists) {
    for (const part of raw.split(ARTIST_SPLIT)) {
      let key = normalize(part);
      // "Adele Official Music" -> "adele".
      for (let i = 0; i < 3; i++) {
        const next = key.replace(ARTIST_NOISE, "").trim();
        if (next === key || !next) break;
        key = next;
      }
      key = key.replace(/^the\s+/u, "");
      if (key) keys.add(key);
    }
  }

  return [...keys];
}

/** Title plus first artist, for a quick "is this the same song" check. */
export function trackKey(track: ComparableTrack): string {
  return `${artistKeys(track.artists)[0] ?? ""}|${titleKey(track.name)}`;
}

/**
 * Filler both services drop or add freely, so requiring them on both sides
 * would only cause misses. Words of one or two letters go with them.
 */
const FILLER_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "for", "with",
  "feat", "ft", "featuring", "vs", "versus",
  "el", "la", "los", "las", "un", "una", "unos", "unas", "del", "con", "por",
  "para", "que", "los", "y", "e", "o",
  "le", "les", "du", "des", "et", "der", "die", "das", "und",
]);

/** How many meaningful words a song needs before containment is trusted. */
const MIN_CONTAINED_WORDS = 2;
/** At least one of them has to be this long, so "The One" never swallows a playlist. */
const MIN_CONTAINED_LENGTH = 4;

/** Every meaningful word of the artists and the title, without duplicates. */
export function trackWords(track: ComparableTrack): string[] {
  const text = normalize(`${track.artists.join(" ")} ${track.name}`);
  return [
    ...new Set(
      text.split(" ").filter((word) => word.length > 2 && !FILLER_WORDS.has(word)),
    ),
  ];
}

/** Whether a word bag says enough to be matched by containment alone. */
function isSpecific(words: string[]): boolean {
  return (
    words.length >= MIN_CONTAINED_WORDS &&
    words.some((word) => word.length >= MIN_CONTAINED_LENGTH)
  );
}

function isContainedIn(small: string[], big: string[]): boolean {
  return isSpecific(small) && small.every((word) => big.includes(word));
}

/**
 * True when one song's words all appear in the other's, whichever way round.
 * Returns how many words the longer side adds, so the tightest fit wins when
 * several candidates would do.
 */
function containmentDistance(a: string[], b: string[]): number | null {
  if (isContainedIn(a, b) || isContainedIn(b, a)) {
    return Math.abs(a.length - b.length);
  }
  return null;
}

export type MatchReason =
  /** Same title, artist in common. */
  | "exact"
  /** One song's words all appear in the other's. */
  | "contained"
  /** Same title, no artist in common. */
  | "title";

export type TrackPair<T> = { a: T; b: T; reason: MatchReason };

export type TrackComparison<T> = {
  /** The same song on both sides ("exact" or "contained"). */
  matched: TrackPair<T>[];
  /** Same title, no artist in common: worth a look before copying. */
  possible: TrackPair<T>[];
  /** In `a` only. */
  onlyInA: T[];
  /** In `b` only. */
  onlyInB: T[];
};

type Slot<T> = {
  track: T;
  order: number;
  titleKey: string;
  artists: string[];
  words: string[];
};

function toSlots<T extends ComparableTrack>(tracks: T[]): Slot<T>[] {
  return tracks.map((track, order) => ({
    track,
    order,
    titleKey: titleKey(track.name),
    artists: artistKeys(track.artists),
    words: trackWords(track),
  }));
}

function sharesArtist(a: Slot<unknown>, b: Slot<unknown>): boolean {
  return a.artists.some((artist) => b.artists.includes(artist));
}

/**
 * Pairs the songs of the two playlists in the three passes described at the
 * top of the file. Each song is used at most once, so a playlist holding the
 * same track twice reports the second copy as missing on the other side rather
 * than matching it twice.
 */
export function compareTrackLists<T extends ComparableTrack>(
  a: T[],
  b: T[],
): TrackComparison<T> {
  const slotsA = toSlots(a);
  const slotsB = toSlots(b);
  /** `order` of the songs of `b` already paired with one of `a`. */
  const taken = new Set<number>();

  const byTitle = new Map<string, Slot<T>[]>();
  for (const slot of slotsB) {
    if (!slot.titleKey) continue;
    const bucket = byTitle.get(slot.titleKey);
    if (bucket) bucket.push(slot);
    else byTitle.set(slot.titleKey, [slot]);
  }

  const free = (slot: Slot<T>) => !taken.has(slot.order);
  const sameTitle = (slot: Slot<T>) =>
    (slot.titleKey ? byTitle.get(slot.titleKey) : undefined) ?? [];

  const matched: (TrackPair<T> & { order: number })[] = [];
  const possible: TrackPair<T>[] = [];

  function pair(
    from: Slot<T>,
    to: Slot<T>,
    reason: MatchReason,
  ): TrackPair<T> {
    taken.add(to.order);
    return { a: from.track, b: to.track, reason };
  }

  // 1. Same title and an artist in common: the safest pairing, so it goes first
  //    and gets first pick of the candidates.
  const afterTitle: Slot<T>[] = [];
  for (const slot of slotsA) {
    const found = sameTitle(slot).find(
      (candidate) => free(candidate) && sharesArtist(slot, candidate),
    );
    if (found) matched.push({ ...pair(slot, found, "exact"), order: slot.order });
    else afterTitle.push(slot);
  }

  // 2. One song's words all appear in the other's, in any order. The candidate
  //    that adds the fewest extra words wins.
  const afterWords: Slot<T>[] = [];
  for (const slot of afterTitle) {
    let best: Slot<T> | null = null;
    let bestDistance = Infinity;

    for (const candidate of slotsB) {
      if (!free(candidate)) continue;
      const distance = containmentDistance(slot.words, candidate.words);
      if (distance !== null && distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }

    if (best) matched.push({ ...pair(slot, best, "contained"), order: slot.order });
    else afterWords.push(slot);
  }

  // 3. Same title, nothing else in common: reported, never treated as certain.
  const onlyInA: T[] = [];
  for (const slot of afterWords) {
    const found = sameTitle(slot).find(free);
    if (found) possible.push(pair(slot, found, "title"));
    else onlyInA.push(slot.track);
  }

  return {
    // Rebuilt in playlist order: the passes run out of order by design.
    matched: matched
      .sort((left, right) => left.order - right.order)
      .map((entry): TrackPair<T> => ({ a: entry.a, b: entry.b, reason: entry.reason })),
    possible,
    onlyInA,
    onlyInB: slotsB.filter(free).map((slot) => slot.track),
  };
}

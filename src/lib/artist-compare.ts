/**
 * Compares the two complete artist lists to find who is followed on one
 * service but not on the other.
 *
 * Names are the only thing the two services share, so they are compared
 * loosely: case, accents and punctuation are ignored, a leading "The" is
 * dropped, and the words channels tack on ("Official", "Music", "VEVO",
 * "Topic"...) are removed. Two artists with genuinely different spellings
 * ("Beatles" vs "The Beatles" match; "P!nk" vs "Pink" also match, but a stage
 * name spelled differently on each service will not).
 *
 * Kept free of imports so `node --test` can load it directly.
 */

export type ComparableArtist = { id: string; name: string };

const TRAILING_NOISE =
  /\s+(?:official|oficial|officiel|music|musica|música|tv|channel|canal|vevo|topic|records|band)$/iu;

/** The key both lists are matched on. */
export function artistKey(name: string): string {
  let key = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

  // "Adele Official Music" -> "adele".
  for (let i = 0; i < 3; i++) {
    const next = key.replace(TRAILING_NOISE, "").trim();
    if (next === key || !next) break;
    key = next;
  }

  return key.replace(/^the\s+/u, "") || name.trim().toLowerCase();
}

export type Comparison<T extends ComparableArtist> = {
  /** In `a` only. */
  onlyInA: T[];
  /** In `b` only. */
  onlyInB: T[];
  /** Matched on both sides. */
  shared: number;
};

export function compareArtistLists<T extends ComparableArtist>(
  a: T[],
  b: T[],
): Comparison<T> {
  const keysA = new Map<string, T>();
  for (const artist of a) {
    const key = artistKey(artist.name);
    if (key && !keysA.has(key)) keysA.set(key, artist);
  }

  const keysB = new Map<string, T>();
  for (const artist of b) {
    const key = artistKey(artist.name);
    if (key && !keysB.has(key)) keysB.set(key, artist);
  }

  const onlyInA: T[] = [];
  const onlyInB: T[] = [];
  let shared = 0;

  for (const [key, artist] of keysA) {
    if (keysB.has(key)) shared++;
    else onlyInA.push(artist);
  }
  for (const [key, artist] of keysB) {
    if (!keysA.has(key)) onlyInB.push(artist);
  }

  return { onlyInA, onlyInB, shared };
}

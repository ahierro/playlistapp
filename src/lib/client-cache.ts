/**
 * localStorage layer for lists that cost a full pagination walk (Spotify or YouTube Music).
 *
 * Pure storage: read, write, clear. Deciding *when* to go back to the API is
 * `@/lib/list-store`'s job.
 *
 * Every access is wrapped in try/catch: localStorage throws in private windows,
 * when the user blocks site data, and when the quota is full. None of that should
 * break the page, it should only mean "no cache this time".
 */

const PREFIX = "playlistapp";

/** Bump this when the cached shape changes, so old entries are ignored instead of crashing the UI. */
const CACHE_VERSION = 4;

export type CacheEntry<T> = {
  version: number;
  /** Epoch ms of the moment the data came back from the API. */
  updatedAt: number;
  data: T;
};

/** Keys are scoped per user so signing in with another account never reads the previous list. */
function storageKey(name: string, scope: string) {
  return `${PREFIX}:${name}:${scope}`;
}

export function readCache<T>(
  name: string,
  scope: string,
): CacheEntry<T> | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(storageKey(name, scope));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as CacheEntry<T> | null;
    if (
      !parsed ||
      parsed.version !== CACHE_VERSION ||
      typeof parsed.updatedAt !== "number" ||
      parsed.data === undefined
    ) {
      return null;
    }

    return parsed;
  } catch {
    // Unparseable or unreadable: behave as a cache miss.
    return null;
  }
}

/**
 * Stores the list and returns the entry. The entry is returned even when storage
 * refuses it, so the list still renders for this page view; it just will not
 * survive a reload.
 */
export function writeCache<T>(
  name: string,
  scope: string,
  data: T,
): CacheEntry<T> {
  const entry: CacheEntry<T> = {
    version: CACHE_VERSION,
    updatedAt: Date.now(),
    data,
  };

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        storageKey(name, scope),
        JSON.stringify(entry),
      );
    } catch {
      // Quota exceeded or storage blocked.
    }
  }

  return entry;
}

export function clearCache(name: string, scope: string) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(storageKey(name, scope));
  } catch {
    // If we cannot remove it, the version guard will retire it eventually.
  }
}

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
  ["week", 4.35],
  ["month", 12],
  ["year", Number.POSITIVE_INFINITY],
];

/** "2 minutes ago" / "yesterday". Returns null when there is no timestamp yet. */
export function formatUpdatedAt(timestamp: number | null): string | null {
  if (!timestamp) return null;

  let value = (timestamp - Date.now()) / 1000;

  for (const [unit, size] of UNITS) {
    if (Math.abs(value) < size) {
      return relativeTime.format(Math.round(value), unit);
    }
    value /= size;
  }

  return relativeTime.format(Math.round(value), "year");
}

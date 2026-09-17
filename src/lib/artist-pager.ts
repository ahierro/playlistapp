/**
 * Infinite-scroll pager for the artists pages.
 *
 * Every batch shown has the same size (PAGE_SIZE) for both services. Spotify
 * can be asked for exactly that many, but a YouTube page is 50 subscriptions
 * filtered down to artists, so it can hold anything from 0 to 50. Remote pages
 * therefore go into a buffer, and a batch is taken from it once it holds enough.
 *
 * State lives at module level, keyed by service and account, so going to
 * another page of the app and back keeps what was already loaded.
 *
 * Downloading the .txt fetches the COMPLETE list, and that one is saved in
 * localStorage: from then on the page opens with every artist, straight from
 * the cache, until the refresh button clears it.
 */

import { MissingScopeError, SessionExpiredError } from "@/lib/api-client";
import { clearCache, readCache, writeCache } from "@/lib/client-cache";
import { normalizeText } from "@/lib/youtube-match";
import type { ArtistSummary, MusicService } from "@/lib/music";
import { SERVICES } from "@/lib/services";

export const PAGE_SIZE = 20;

/** Remote pages fetched per batch at most, so a run of empty YouTube pages cannot loop for long. */
const MAX_REMOTE_PAGES_PER_BATCH = 8;

export type PagerState = {
  items: ArtistSummary[];
  loading: boolean;
  /** No more artists on the service. */
  done: boolean;
  error: string | null;
  sessionExpired: boolean;
  missingScope: string | null;
  /** The items come from the complete list saved in localStorage. */
  complete: boolean;
  /** When that cached complete list was fetched. */
  updatedAt: number | null;
};

type Internal = PagerState & {
  service: MusicService;
  userId: string;
  buffer: ArtistSummary[];
  cursor: string | null;
  remoteDone: boolean;
  seenIds: Set<string>;
  /** "Adele" and "Adele - Topic" are the same artist once cleaned. */
  seenNames: Set<string>;
  controller: AbortController | null;
  snapshot: PagerState;
};

const INITIAL: PagerState = {
  items: [],
  loading: false,
  done: false,
  error: null,
  sessionExpired: false,
  missingScope: null,
  complete: false,
  updatedAt: null,
};

const pagers = new Map<string, Internal>();
const listeners = new Set<() => void>();

function keyOf(service: MusicService, userId: string) {
  return `${service}::${userId}`;
}

function fresh(): Internal {
  return {
    ...INITIAL,
    service: "spotify",
    userId: "",
    buffer: [],
    cursor: null,
    remoteDone: false,
    seenIds: new Set(),
    seenNames: new Set(),
    controller: null,
    snapshot: INITIAL,
  };
}

function get(key: string): Internal {
  let pager = pagers.get(key);
  if (!pager) {
    pager = fresh();
    pagers.set(key, pager);
  }
  return pager;
}

/**
 * Creates the pager for this list, filling it from the complete list in
 * localStorage when there is one.
 */
function getOrLoad(service: MusicService, userId: string): Internal {
  const key = keyOf(service, userId);
  let pager = pagers.get(key);
  if (pager) return pager;

  pager = fresh();
  pager.service = service;
  pager.userId = userId;

  const cached = readCache<ArtistSummary[]>(
    SERVICES[service].artists.fullCacheKey,
    userId,
  );
  if (cached) {
    pager.items = cached.data;
    pager.done = true;
    pager.complete = true;
    pager.updatedAt = cached.updatedAt;
  }

  pagers.set(key, pager);
  publish(key, {});
  return pager;
}

function publish(key: string, patch: Partial<Internal>) {
  const pager = Object.assign(get(key), patch);
  // New object only when something visible changed, for useSyncExternalStore.
  pager.snapshot = {
    items: pager.items,
    loading: pager.loading,
    done: pager.done,
    error: pager.error,
    sessionExpired: pager.sessionExpired,
    missingScope: pager.missingScope,
    complete: pager.complete,
    updatedAt: pager.updatedAt,
  };
  for (const listener of listeners) listener();
}

export function subscribePager(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPagerState(service: MusicService, userId: string): PagerState {
  if (typeof window === "undefined") return INITIAL;
  return getOrLoad(service, userId).snapshot;
}

export function getServerPagerState(): PagerState {
  return INITIAL;
}

/** Loads the next batch. Does nothing while a load is running or at the end. */
export async function loadMoreArtists(service: MusicService, userId: string) {
  const key = keyOf(service, userId);
  const pager = getOrLoad(service, userId);
  if (pager.loading || pager.done || pager.error || pager.missingScope) return;

  const controller = new AbortController();
  publish(key, { loading: true, controller });

  const { fetchPage } = SERVICES[service].artists;

  try {
    let remotePages = 0;
    while (
      pager.buffer.length < PAGE_SIZE &&
      !pager.remoteDone &&
      remotePages < MAX_REMOTE_PAGES_PER_BATCH
    ) {
      const page = await fetchPage(pager.cursor, {
        limit: PAGE_SIZE,
        signal: controller.signal,
      });
      remotePages++;

      for (const artist of page.items) {
        const name = normalizeText(artist.name);
        if (pager.seenIds.has(artist.id) || pager.seenNames.has(name)) continue;
        pager.seenIds.add(artist.id);
        pager.seenNames.add(name);
        pager.buffer.push(artist);
      }

      if (!page.next || page.next === pager.cursor) pager.remoteDone = true;
      pager.cursor = page.next;
    }

    if (controller.signal.aborted) return;

    const batch = pager.buffer.splice(0, PAGE_SIZE);
    publish(key, {
      items: [...pager.items, ...batch],
      loading: false,
      controller: null,
      done: pager.remoteDone && pager.buffer.length === 0,
    });
  } catch (cause) {
    if (controller.signal.aborted) return;

    publish(key, {
      loading: false,
      controller: null,
      sessionExpired: cause instanceof SessionExpiredError,
      missingScope:
        cause instanceof MissingScopeError ? cause.message || "" : null,
      error:
        cause instanceof SessionExpiredError || cause instanceof MissingScopeError
          ? null
          : cause instanceof Error
            ? cause.message
            : "Could not load the artists",
    });
  }
}

/** Retries after an error, keeping what is already on screen. */
export function retryArtists(service: MusicService, userId: string) {
  publish(keyOf(service, userId), { error: null });
  void loadMoreArtists(service, userId);
}

/**
 * The complete list saved in localStorage, or null when it was never
 * downloaded. Used by the comparison page.
 */
export function getCompleteArtists(
  service: MusicService,
  userId: string,
): { items: ArtistSummary[]; updatedAt: number } | null {
  if (typeof window === "undefined") return null;
  const cached = readCache<ArtistSummary[]>(
    SERVICES[service].artists.fullCacheKey,
    userId,
  );
  return cached ? { items: cached.data, updatedAt: cached.updatedAt } : null;
}

/**
 * Replaces everything with the complete list and saves it in localStorage, so
 * the next visit opens with it. Called after the download built the .txt.
 */
export function storeCompleteArtists(
  service: MusicService,
  userId: string,
  items: ArtistSummary[],
) {
  const key = keyOf(service, userId);
  const pager = getOrLoad(service, userId);
  pager.controller?.abort();
  pager.buffer = [];
  pager.cursor = null;
  pager.remoteDone = true;
  pager.seenIds = new Set(items.map((artist) => artist.id));
  pager.seenNames = new Set(items.map((artist) => normalizeText(artist.name)));

  const entry = writeCache(
    SERVICES[service].artists.fullCacheKey,
    userId,
    items,
  );

  publish(key, {
    items,
    loading: false,
    done: true,
    complete: true,
    updatedAt: entry.updatedAt,
    error: null,
    controller: null,
  });
}

/**
 * localStorage keys earlier versions used for the artist lists. The pager keeps
 * nothing there, but these may still sit in the browser.
 */
const LEGACY_ARTIST_CACHES: Record<MusicService, string[]> = {
  spotify: ["followed-artists", "followed-artists-first-page"],
  "youtube-music": ["yt-artists", "yt-artists-first-page"],
};

/**
 * The refresh button: clears this list's localStorage cache (the complete list
 * included) and what is loaded in memory, then fetches the first batch again.
 * Nothing else: the server-side caches (upload and Spotify checks) are left alone.
 */
export function resetArtists(service: MusicService, userId: string) {
  for (const name of LEGACY_ARTIST_CACHES[service]) clearCache(name, userId);
  clearCache(SERVICES[service].artists.fullCacheKey, userId);

  const key = keyOf(service, userId);
  get(key).controller?.abort();
  const pager = fresh();
  pager.service = service;
  pager.userId = userId;
  pagers.set(key, pager);
  publish(key, {});
  void loadMoreArtists(service, userId);
}

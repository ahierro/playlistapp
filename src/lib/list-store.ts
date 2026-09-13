/**
 * Tiny external store holding, per list, the cached data plus the state of the
 * request that would refresh it.
 *
 * Living outside React has two upsides: components read it through
 * `useSyncExternalStore` (so the server renders "nothing cached" and React swaps
 * in the real snapshot after hydration, with no mismatch), and two components
 * mounted on the same list share one request instead of racing.
 *
 * The policy is cache-first with no automatic revalidation: a cache hit issues no
 * request at all, and after the first load only `refreshList` goes back to Spotify.
 */

import { readCache, writeCache, type CacheEntry } from "@/lib/client-cache";
import { MissingScopeError, SessionExpiredError } from "@/lib/spotify-client";

export type ListStatus =
  /** Nothing to show yet; the first fetch is in flight or about to start. */
  | "loading"
  /** A list is already on screen and we are fetching it again. */
  | "refreshing"
  | "ready"
  | "error"
  /** Spotify answered 403: the session predates a scope we now need. */
  | "missing-scope"
  /** Spotify answered 401: the session is gone and the user has to sign in again. */
  | "session-expired";

export type ListState<T> = {
  entry: CacheEntry<T[]> | null;
  status: ListStatus;
  error: string | null;
};

type Fetcher<T> = (signal?: AbortSignal) => Promise<T[]>;
type Sorter<T> = (items: T[]) => T[];

const INITIAL: ListState<never> = {
  entry: null,
  status: "loading",
  error: null,
};

/** Snapshots are cached by key so `useSyncExternalStore` sees a stable reference. */
const states = new Map<string, ListState<never>>();
const inFlight = new Map<string, AbortController>();
const listeners = new Set<() => void>();

function storeKey(name: string, scope: string) {
  return `${name}::${scope}`;
}

export function subscribeToLists(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish<T>(key: string, state: ListState<T>) {
  states.set(key, state as unknown as ListState<never>);
  for (const listener of listeners) listener();
}

export function getListSnapshot<T>(name: string, scope: string): ListState<T> {
  // Never populate the map on the server: module state there is shared between requests.
  if (typeof window === "undefined") return INITIAL as unknown as ListState<T>;

  const key = storeKey(name, scope);
  let state = states.get(key) as ListState<T> | undefined;

  if (!state) {
    const entry = readCache<T[]>(name, scope);
    state = entry
      ? { entry, status: "ready", error: null }
      : (INITIAL as unknown as ListState<T>);
    states.set(key, state as unknown as ListState<never>);
  }

  return state;
}

/** During SSR and hydration there is no localStorage, so nothing is cached. */
export function getServerListSnapshot<T>(): ListState<T> {
  return INITIAL as unknown as ListState<T>;
}

async function run<T>(
  name: string,
  scope: string,
  fetchAll: Fetcher<T>,
  sort: Sorter<T>,
) {
  const key = storeKey(name, scope);

  // A newer call supersedes the one in flight (double click on refresh, remount in dev).
  inFlight.get(key)?.abort();
  const controller = new AbortController();
  inFlight.set(key, controller);

  const previous = getListSnapshot<T>(name, scope).entry;
  publish<T>(key, {
    entry: previous,
    status: previous ? "refreshing" : "loading",
    error: null,
  });

  try {
    const items = sort(await fetchAll(controller.signal));
    if (controller.signal.aborted) return;

    publish<T>(key, {
      entry: writeCache(name, scope, items),
      status: "ready",
      error: null,
    });
  } catch (cause) {
    if (controller.signal.aborted) return;

    // Keep whatever was already on screen: a failed refresh should not blank the page.
    if (cause instanceof SessionExpiredError) {
      publish<T>(key, {
        entry: previous,
        status: "session-expired",
        error: cause.message,
      });
      return;
    }

    if (cause instanceof MissingScopeError) {
      publish<T>(key, {
        entry: previous,
        status: "missing-scope",
        error: cause.message,
      });
      return;
    }

    publish<T>(key, {
      entry: previous,
      status: "error",
      error:
        cause instanceof Error ? cause.message : "Could not reach Spotify",
    });
  } finally {
    if (inFlight.get(key) === controller) inFlight.delete(key);
  }
}

/**
 * Starts the first fetch only when there is genuinely nothing to show: a cache hit,
 * a request already in flight or an earlier failure all leave it alone. A failure
 * waits for the user to press refresh rather than retrying on every render.
 */
export function ensureListLoaded<T>(
  name: string,
  scope: string,
  fetchAll: Fetcher<T>,
  sort: Sorter<T>,
) {
  const key = storeKey(name, scope);
  if (inFlight.has(key)) return;
  if (getListSnapshot<T>(name, scope).status !== "loading") return;

  void run(name, scope, fetchAll, sort);
}

/** Explicit refresh: always goes back to Spotify and overwrites the cache. */
export function refreshList<T>(
  name: string,
  scope: string,
  fetchAll: Fetcher<T>,
  sort: Sorter<T>,
) {
  void run(name, scope, fetchAll, sort);
}

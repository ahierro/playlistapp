"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import {
  ensureListLoaded,
  getListSnapshot,
  getServerListSnapshot,
  refreshList,
  subscribeToLists,
} from "@/lib/list-store";

type Options<T> = {
  /** Cache name, e.g. "followed-artists". Combined with `scope` to build the storage key. */
  cacheKey: string;
  /** Per-user scope so two accounts on the same browser never share a list. */
  scope: string;
  /** Must be a stable reference (a module-level function), or the effect re-runs on every render. */
  fetchAll: (signal?: AbortSignal) => Promise<T[]>;
  /** Also stable. Applied before caching, so what we store is already sorted. */
  sort: (items: T[]) => T[];
};

export type CachedList<T> = {
  /** null while there is nothing cached and the first fetch has not landed. */
  items: T[] | null;
  updatedAt: number | null;
  /** First load with nothing to show yet. */
  isLoading: boolean;
  /** A refresh on top of a list that is already on screen. */
  isRefreshing: boolean;
  error: string | null;
  /** Set when Spotify answered 403: the session predates a scope we need. */
  missingScope: string | null;
  refresh: () => void;
};

/**
 * Thin React binding over `@/lib/list-store`: it subscribes to one list and
 * kicks off the first fetch when the cache is empty. All the actual state lives
 * in the store.
 */
export function useCachedList<T>({
  cacheKey,
  scope,
  fetchAll,
  sort,
}: Options<T>): CachedList<T> {
  const router = useRouter();

  const state = useSyncExternalStore(
    subscribeToLists,
    () => getListSnapshot<T>(cacheKey, scope),
    () => getServerListSnapshot<T>(),
  );

  useEffect(() => {
    ensureListLoaded(cacheKey, scope, fetchAll, sort);
  }, [cacheKey, scope, fetchAll, sort]);

  // 401: the refresh token is gone too, so there is nothing to do but sign in again.
  useEffect(() => {
    if (state.status === "session-expired") router.push("/");
  }, [state.status, router]);

  const refresh = useCallback(() => {
    refreshList(cacheKey, scope, fetchAll, sort);
  }, [cacheKey, scope, fetchAll, sort]);

  return {
    items: state.entry?.data ?? null,
    updatedAt: state.entry?.updatedAt ?? null,
    isLoading: state.status === "loading",
    isRefreshing: state.status === "refreshing",
    error: state.status === "error" ? state.error : null,
    missingScope: state.status === "missing-scope" ? (state.error ?? "") : null,
    refresh,
  };
}

/**
 * Browser-side helpers shared by the Spotify and YouTube Music fetchers. They
 * talk to our own `/api/*` routes, the only place the access tokens live.
 */

/** The route answered 401: the session is gone and the user has to sign in again. */
export class SessionExpiredError extends Error {
  constructor(message = "The session expired") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

/** The route answered 403: a permission (scope) the app needs is missing. */
export class MissingScopeError extends Error {
  constructor(message = "A permission is missing") {
    super(message);
    this.name = "MissingScopeError";
  }
}

/** Safety cap for every pagination walk: 50 items * 200 pages = 10,000. */
export const MAX_PAGES = 200;

export async function getJson<T>(
  url: string,
  { signal, service }: { signal?: AbortSignal; service: string },
): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });

  // The error routes always answer JSON, but never trust that under a proxy.
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;

  if (response.status === 401) throw new SessionExpiredError(body?.error);
  if (response.status === 403) throw new MissingScopeError(body?.error);

  if (!response.ok) {
    throw new Error(
      body?.error ?? `${service} request failed (${response.status})`,
    );
  }

  if (!body) throw new Error(`${service} returned an empty response`);

  return body;
}

/**
 * Walks a paginated route until it runs out of pages. `next` is whatever the
 * route uses to point at the following page (cursor, offset or page token).
 */
export async function walkPages<Page, Item>({
  pageUrl,
  service,
  signal,
  getItems,
  getNext,
  getKey,
}: {
  pageUrl: (next: string | null) => string;
  service: string;
  signal?: AbortSignal;
  getItems: (page: Page) => Item[];
  getNext: (page: Page) => string | null;
  /** When given, items with a key already seen are dropped. */
  getKey?: (item: Item) => string;
}): Promise<Item[]> {
  const all: Item[] = [];
  const seen = new Set<string>();
  let next: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data: Page = await getJson<Page>(pageUrl(next), { signal, service });

    // Pushed one by one: spreading a few thousand items can overflow the stack.
    for (const item of getItems(data)) {
      if (getKey) {
        const key = getKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
      }
      all.push(item);
    }

    const following = getNext(data);
    // Guard against a cursor that does not advance.
    if (!following || following === next) break;
    next = following;
  }

  return all;
}

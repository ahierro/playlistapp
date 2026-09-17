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

/**
 * The route answered 429: a rate limit, or for YouTube the daily quota. The
 * copy queue pauses on it instead of failing.
 */
export class QuotaExceededError extends Error {
  constructor(message = "The API quota is exhausted") {
    super(message);
    this.name = "QuotaExceededError";
  }
}

/** Any other non-2xx answer, with its status kept for callers that care. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
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

  throwForStatus(response, body?.error, service);

  if (!body) throw new Error(`${service} returned an empty response`);

  return body;
}

function throwForStatus(
  response: Response,
  message: string | undefined,
  service: string,
) {
  if (response.status === 401) throw new SessionExpiredError(message);
  if (response.status === 403) throw new MissingScopeError(message);
  if (response.status === 429) throw new QuotaExceededError(message);

  if (!response.ok) {
    throw new ApiError(
      message ?? `${service} request failed (${response.status})`,
      response.status,
    );
  }
}

/** POST / DELETE to one of our routes. Resolves to null on 204. */
export async function sendJson<T>(
  url: string,
  {
    method,
    body,
    service,
    signal,
  }: {
    method: "POST" | "DELETE";
    body?: unknown;
    service: string;
    signal?: AbortSignal;
  },
): Promise<T | null> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal,
  });

  if (response.status === 204) return null;

  const data = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;

  throwForStatus(response, data?.error, service);
  return data;
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

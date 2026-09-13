const API_BASE = "https://api.spotify.com/v1";

/** The access token is no longer usable (expired / revoked / missing scope). */
export class SpotifyAuthError extends Error {
  constructor(message = "The Spotify session is not valid") {
    super(message);
    this.name = "SpotifyAuthError";
  }
}

/** Any other error returned by the Web API. */
export class SpotifyApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SpotifyApiError";
    this.status = status;
  }
}

export type SpotifyImage = {
  url: string;
  width: number | null;
  height: number | null;
};

/**
 * Artist as returned by the Web API.
 *
 * Watch out for the February 2026 changes (https://developer.spotify.com/documentation/web-api/references/changes/february-2026):
 * `followers` and `popularity` were REMOVED from the Artist object. We keep them
 * optional so nothing breaks if the account has extended access and does get them.
 */
export type SpotifyArtist = {
  id: string;
  name: string;
  genres?: string[];
  popularity?: number;
  followers?: { total: number };
  images: SpotifyImage[];
  external_urls: { spotify: string };
  uri: string;
};

export type FollowedArtistsPage = {
  items: SpotifyArtist[];
  /** Cursor for requesting the next page. null when there are no more. */
  nextCursor: string | null;
  /** Total followed artists (Spotify reports it on the first page). */
  total: number;
};

type FollowedArtistsResponse = {
  artists: {
    items: SpotifyArtist[];
    next: string | null;
    cursors: { after: string | null };
    total: number;
    limit: number;
  };
};

async function spotifyFetch(
  path: string,
  accessToken: string,
  init?: RequestInit,
) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (response.status === 401) {
    throw new SpotifyAuthError();
  }

  if (response.status === 403) {
    throw new SpotifyApiError(
      "Spotify rejected the request (403). This is usually a missing scope, a user not enabled in the app (Development Mode allows up to 5) or an endpoint outside the supported set.",
      403,
    );
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After") ?? "a few";
    throw new SpotifyApiError(
      `You hit the Spotify rate limit. Retry in ${retryAfter} seconds.`,
      429,
    );
  }

  if (!response.ok) {
    throw new SpotifyApiError(
      `Spotify Web API error (${response.status}): ${await response.text()}`,
      response.status,
    );
  }

  return response;
}

/**
 * Fetches one page of followed artists.
 * GET /me/following paginates by cursor (`after`), not by offset.
 * Requires the `user-follow-read` scope.
 */
export async function getFollowedArtists(
  accessToken: string,
  { after, limit = 50 }: { after?: string | null; limit?: number } = {},
): Promise<FollowedArtistsPage> {
  const params = new URLSearchParams({
    type: "artist",
    limit: String(Math.min(Math.max(limit, 1), 50)),
  });

  if (after) params.set("after", after);

  const response = await spotifyFetch(`/me/following?${params}`, accessToken);
  const { artists } = (await response.json()) as FollowedArtistsResponse;

  return {
    items: artists.items,
    nextCursor: artists.next ? artists.cursors.after : null,
    total: artists.total,
  };
}

/** Returns the smallest image that reaches the requested size (to avoid downloading 640px for nothing). */
export function pickArtistImage(artist: SpotifyArtist, minSize = 160) {
  const sorted = [...artist.images].sort(
    (a, b) => (a.width ?? 0) - (b.width ?? 0),
  );
  return sorted.find((image) => (image.width ?? 0) >= minSize) ?? sorted.at(-1);
}

/**
 * Fetches EVERY followed artist by walking the cursor pagination.
 * `maxPages` is a safety cap so we never end up in an infinite loop if Spotify
 * returns a cursor that does not advance (50 * 200 = 10,000 artists).
 */
export async function getAllFollowedArtists(
  accessToken: string,
  { maxPages = 200 }: { maxPages?: number } = {},
): Promise<SpotifyArtist[]> {
  const all: SpotifyArtist[] = [];
  const seen = new Set<string>();
  let after: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const { items, nextCursor } = await getFollowedArtists(accessToken, {
      after,
      limit: 50,
    });

    for (const artist of items) {
      // Guard against repeated cursors: never duplicate an artist.
      if (seen.has(artist.id)) continue;
      seen.add(artist.id);
      all.push(artist);
    }

    if (!nextCursor || nextCursor === after) break;
    after = nextCursor;
  }

  return all;
}

/**
 * Alphabetical ordering with `Intl.Collator`: it handles accents and case the way
 * a person would ("Angela" between "Andrew" and "Beth", not at the end), and sorts
 * embedded numbers by value ("Artist 2" before "Artist 10").
 */
const nameCollator = new Intl.Collator("en", {
  sensitivity: "base",
  numeric: true,
});

export function sortArtistsByName(artists: SpotifyArtist[]): SpotifyArtist[] {
  return [...artists].sort((a, b) => nameCollator.compare(a.name, b.name));
}

/**
 * Playlist as returned by `GET /me/playlists`.
 *
 * February 2026 change: the Playlist object renamed `tracks` to `items`
 * (and `tracks.tracks.track` to `items.items.item`). We declare both shapes as
 * optional and read whichever one arrives, so it works with either.
 */
export type SpotifyPlaylist = {
  id: string;
  name: string;
  description: string | null;
  collaborative: boolean;
  public: boolean | null;
  owner: { id: string; display_name?: string | null };
  images: SpotifyImage[] | null;
  items?: { total: number };
  tracks?: { total: number };
  external_urls: { spotify: string };
  uri: string;
};

export type PlaylistsPage = {
  items: SpotifyPlaylist[];
  /** Offset of the next page. null when there are no more. */
  nextOffset: number | null;
  total: number;
};

type PlaylistsResponse = {
  items: SpotifyPlaylist[];
  next: string | null;
  offset: number;
  limit: number;
  total: number;
};

/**
 * Fetches one page of the user playlists.
 * Unlike `/me/following`, this endpoint paginates by OFFSET, not by cursor.
 * Requires the `playlist-read-private` and `playlist-read-collaborative` scopes.
 */
export async function getUserPlaylists(
  accessToken: string,
  { offset = 0, limit = 50 }: { offset?: number; limit?: number } = {},
): Promise<PlaylistsPage> {
  const params = new URLSearchParams({
    limit: String(Math.min(Math.max(limit, 1), 50)),
    offset: String(Math.max(offset, 0)),
  });

  const response = await spotifyFetch(`/me/playlists?${params}`, accessToken);
  const data = (await response.json()) as PlaylistsResponse;

  return {
    items: data.items,
    nextOffset: data.next ? data.offset + data.items.length : null,
    total: data.total,
  };
}

/** Track count, tolerating the `tracks` -> `items` rename. */
export function playlistTrackCount(playlist: SpotifyPlaylist): number | null {
  return playlist.items?.total ?? playlist.tracks?.total ?? null;
}

/** The smallest image that reaches the requested size. `images` can come back null. */
export function pickPlaylistImage(playlist: SpotifyPlaylist, minSize = 160) {
  const sorted = [...(playlist.images ?? [])].sort(
    (a, b) => (a.width ?? 0) - (b.width ?? 0),
  );
  return sorted.find((image) => (image.width ?? 0) >= minSize) ?? sorted.at(-1);
}

/**
 * Fetches EVERY playlist of the user by walking the offset pagination.
 * `maxPages` is the same safety cap used for artists.
 */
export async function getAllUserPlaylists(
  accessToken: string,
  { maxPages = 200 }: { maxPages?: number } = {},
): Promise<SpotifyPlaylist[]> {
  const all: SpotifyPlaylist[] = [];
  const seen = new Set<string>();
  let offset = 0;

  for (let page = 0; page < maxPages; page++) {
    const { items, nextOffset } = await getUserPlaylists(accessToken, {
      offset,
      limit: 50,
    });

    for (const playlist of items) {
      if (seen.has(playlist.id)) continue;
      seen.add(playlist.id);
      all.push(playlist);
    }

    if (nextOffset === null || nextOffset === offset) break;
    offset = nextOffset;
  }

  return all;
}

export function sortPlaylistsByName(
  playlists: SpotifyPlaylist[],
): SpotifyPlaylist[] {
  return [...playlists].sort((a, b) => nameCollator.compare(a.name, b.name));
}

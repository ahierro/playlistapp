import type { ExportedTrack } from "@/lib/music";
import { pickBestMatch, type VideoCandidate } from "@/lib/youtube-match";

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
  /** Seconds to wait, on a 429. */
  readonly retryAfter?: number;

  constructor(message: string, status: number, retryAfter?: number) {
    super(message);
    this.name = "SpotifyApiError";
    this.status = status;
    this.retryAfter = retryAfter;
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
      // Spotify serves some list endpoints (notably /me/playlists, whose track
      // counts lag behind) from a cache. Ask for a fresh copy.
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
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
    const seconds = Number(response.headers.get("Retry-After"));
    const retryAfter = Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
    throw new SpotifyApiError(
      `You hit the Spotify rate limit. Retry in ${retryAfter ?? "a few"} seconds.`,
      429,
      retryAfter,
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

export type { ExportedTrack };

export type PlaylistTracksPage = {
  items: ExportedTrack[];
  /** Offset of the next page. null when there are no more. */
  nextOffset: number | null;
  total: number;
};

type RawArtist = {
  id?: string | null;
  uri?: string | null;
  name?: string | null;
  external_urls?: { spotify?: string | null } | null;
};

type RawMedia = {
  type?: string;
  name?: string | null;
  duration_ms?: number | null;
  album?: { name?: string | null } | null;
  artists?: RawArtist[] | null;
  show?: { name?: string | null; publisher?: string | null } | null;
} | null;

type RawPlaylistItem = {
  /** February 2026 renamed `track` to `item`; we read whichever one arrives. */
  item?: RawMedia;
  track?: RawMedia;
};

type PlaylistTracksResponse = {
  items: RawPlaylistItem[];
  next: string | null;
  offset: number;
  total: number;
};

function toExportedTrack(entry: RawPlaylistItem): ExportedTrack | null {
  const media = entry.item ?? entry.track;

  // Tracks removed from Spotify, or unavailable in the market, come back as null.
  if (!media) return null;

  if (media.type === "episode") {
    return {
      name: media.name ?? "Unknown episode",
      artists: media.show?.publisher ? [media.show.publisher] : [],
      album: media.show?.name ?? null,
      type: "episode",
    };
  }

  return {
    name: media.name ?? "Unknown track",
    artists: (media.artists ?? [])
      .map((artist) => artist.name)
      .filter((name): name is string => Boolean(name)),
    album: media.album?.name ?? null,
    durationMs: media.duration_ms ?? undefined,
  };
}

/**
 * Fetches one page of a playlist's contents, already flattened.
 *
 * February 2026 removed `GET /playlists/{id}/tracks` in favour of
 * `GET /playlists/{id}/items`. The old path now answers 403, which is what the
 * first version of this export ran into.
 *
 * That endpoint is ALSO restricted to playlists the user owns or collaborates on:
 * anything else answers 403 no matter which scopes the token has. Callers are
 * expected to handle that per playlist instead of failing the whole export.
 *
 * We deliberately do NOT use Spotify's `fields` projection: it would shrink the
 * response a lot, but the `track` -> `item` rename makes the right projection
 * ambiguous, and a wrong field name there is a 400 instead of a smaller payload.
 */
export async function getPlaylistItems(
  accessToken: string,
  playlistId: string,
  { offset = 0, limit = 50 }: { offset?: number; limit?: number } = {},
): Promise<PlaylistTracksPage> {
  const params = new URLSearchParams({
    // This endpoint caps at 50 per page, unlike the 100 the old one allowed.
    limit: String(Math.min(Math.max(limit, 1), 50)),
    offset: String(Math.max(offset, 0)),
    // Without this, podcast episodes sitting in a playlist are skipped entirely.
    additional_types: "track,episode",
  });

  const response = await spotifyFetch(
    `/playlists/${encodeURIComponent(playlistId)}/items?${params}`,
    accessToken,
  );
  const data = (await response.json()) as PlaylistTracksResponse;

  const items: ExportedTrack[] = [];
  for (const entry of data.items) {
    const track = toExportedTrack(entry);
    if (track) items.push(track);
  }

  return {
    items,
    // Based on the raw page length, not the filtered one, so skipped entries
    // never make the pagination stall.
    nextOffset: data.next ? data.offset + data.items.length : null,
    total: data.total,
  };
}

/**
 * The signed-in user's Spotify id.
 *
 * Needed to tell apart the playlists the user owns. We cannot rely on the JWT
 * `sub` for it: Auth.js fills that from whatever the provider's profile returned,
 * and it is not guaranteed to be the Spotify user id.
 */
export async function getCurrentUserId(accessToken: string): Promise<string> {
  const response = await spotifyFetch("/me", accessToken);
  const { id } = (await response.json()) as { id: string };
  return id;
}

export function sortPlaylistsByName(
  playlists: SpotifyPlaylist[],
): SpotifyPlaylist[] {
  return [...playlists].sort((a, b) => nameCollator.compare(a.name, b.name));
}

/* ------------------------------------------------------------------ */
/* Writing: used by the YouTube Music -> Spotify copy                  */
/* Needs the playlist-modify-public / playlist-modify-private scopes.  */
/* ------------------------------------------------------------------ */

export async function createSpotifyPlaylist(
  accessToken: string,
  {
    name,
    description,
    isPublic,
  }: { name: string; description?: string; isPublic: boolean },
): Promise<{ id: string; name: string }> {
  const response = await spotifyFetch("/me/playlists", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: name.slice(0, 100),
      // Spotify rejects line breaks in descriptions.
      description: (description ?? "").replace(/[\r\n]+/g, " ").slice(0, 300),
      public: isPublic,
    }),
  });
  const data = (await response.json()) as { id: string; name?: string };
  return { id: data.id, name: data.name ?? name };
}

/** Appends up to 100 tracks. */
export async function addTracksToSpotifyPlaylist(
  accessToken: string,
  playlistId: string,
  uris: string[],
): Promise<void> {
  await spotifyFetch(
    `/playlists/${encodeURIComponent(playlistId)}/items`,
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris: uris.slice(0, 100) }),
    },
  );
}

/** Removes every occurrence of up to 100 tracks. */
export async function removeTracksFromSpotifyPlaylist(
  accessToken: string,
  playlistId: string,
  uris: string[],
): Promise<void> {
  await spotifyFetch(
    `/playlists/${encodeURIComponent(playlistId)}/items`,
    accessToken,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: uris.slice(0, 100).map((uri) => ({ uri })) }),
    },
  );
}

/** Track URIs already in a playlist, one page at a time. */
export async function getSpotifyPlaylistUris(
  accessToken: string,
  playlistId: string,
  { offset = 0 }: { offset?: number } = {},
): Promise<{ uris: string[]; nextOffset: number | null }> {
  const params = new URLSearchParams({
    limit: "50",
    offset: String(Math.max(offset, 0)),
  });
  const response = await spotifyFetch(
    `/playlists/${encodeURIComponent(playlistId)}/items?${params}`,
    accessToken,
  );
  const data = (await response.json()) as {
    items: { item?: { uri?: string } | null; track?: { uri?: string } | null }[];
    next: string | null;
    offset: number;
  };

  return {
    uris: data.items.flatMap((entry) => {
      const uri = (entry.item ?? entry.track)?.uri;
      return uri ? [uri] : [];
    }),
    nextOffset: data.next ? data.offset + data.items.length : null,
  };
}

export type SpotifyTrackMatch = {
  uri: string;
  name: string;
  artists: string[];
  confidence: "high" | "low";
};

type RawSearchTrack = {
  uri: string;
  name: string;
  duration_ms?: number;
  artists?: { name?: string }[];
};

async function searchTracks(accessToken: string, q: string) {
  const params = new URLSearchParams({ q, type: "track", limit: "10" });
  const response = await spotifyFetch(`/search?${params}`, accessToken);
  const data = (await response.json()) as {
    tracks?: { items?: (RawSearchTrack | null)[] };
  };
  return (data.tracks?.items ?? []).filter(
    (track): track is RawSearchTrack => Boolean(track?.uri),
  );
}

/**
 * Finds the Spotify track for a song read from YouTube. Tries a fielded query
 * first (precise), then a plain one (tolerant of spelling). The results are
 * scored with the same rules as the opposite direction: title, artist,
 * duration, and a penalty for live / cover / remix versions.
 */
export async function findTrackOnSpotify(
  accessToken: string,
  track: { name: string; artists: string[]; durationMs?: number | null },
): Promise<SpotifyTrackMatch | null> {
  const artist = track.artists[0] ?? "";
  const clean = (value: string) => value.replace(/"/g, "");
  const queries = [
    artist
      ? `track:"${clean(track.name)}" artist:"${clean(artist)}"`
      : `track:"${clean(track.name)}"`,
    `${artist} ${track.name}`.trim(),
  ];

  for (const q of queries) {
    const results = await searchTracks(accessToken, q);
    const byUri = new Map(results.map((result) => [result.uri, result]));

    const candidates: VideoCandidate[] = results.map((result) => ({
      videoId: result.uri,
      title: result.name,
      // The scorer looks for the artist in the "channel": give it every artist.
      channelTitle: (result.artists ?? []).map((a) => a.name ?? "").join(" "),
      durationSeconds:
        typeof result.duration_ms === "number" ? result.duration_ms / 1000 : null,
    }));

    const best = pickBestMatch(
      { name: track.name, artists: track.artists, durationMs: track.durationMs },
      candidates,
    );
    if (best) {
      const chosen = byUri.get(best.videoId)!;
      return {
        uri: chosen.uri,
        name: chosen.name,
        artists: (chosen.artists ?? []).flatMap((a) => (a.name ? [a.name] : [])),
        confidence: best.confidence,
      };
    }
  }

  return null;
}

/** One track by id, for a link the user pasted during review. */
export async function getSpotifyTrack(
  accessToken: string,
  id: string,
): Promise<{ uri: string; name: string; artists: string[] }> {
  const response = await spotifyFetch(
    `/tracks/${encodeURIComponent(id)}`,
    accessToken,
  );
  const data = (await response.json()) as RawSearchTrack;
  return {
    uri: data.uri,
    name: data.name,
    artists: (data.artists ?? []).flatMap((a) => (a.name ? [a.name] : [])),
  };
}

/* ------------------------------------------------------------------ */
/* Following artists (the "only on YouTube Music" list)                */
/* ------------------------------------------------------------------ */

export type SpotifyArtistHit = {
  uri: string;
  id: string;
  name: string;
  url: string;
  imageUrl: string | null;
};

/** Artists matching a name. Max 10 results since February 2026. */
export async function searchArtists(
  accessToken: string,
  query: string,
): Promise<SpotifyArtistHit[]> {
  const params = new URLSearchParams({ q: query, type: "artist", limit: "10" });
  const response = await spotifyFetch(`/search?${params}`, accessToken);
  const data = (await response.json()) as {
    artists?: { items?: (SpotifyArtist & { uri: string })[] };
  };

  return (data.artists?.items ?? []).map((artist) => ({
    uri: artist.uri,
    id: artist.id,
    name: artist.name,
    url: artist.external_urls.spotify,
    imageUrl: pickArtistImage(artist, 160)?.url ?? null,
  }));
}

/** One artist by id, for the confirmation shown after a follow. */
export async function getSpotifyArtist(
  accessToken: string,
  id: string,
): Promise<SpotifyArtistHit> {
  const response = await spotifyFetch(
    `/artists/${encodeURIComponent(id)}`,
    accessToken,
  );
  const artist = (await response.json()) as SpotifyArtist & { uri: string };

  return {
    uri: artist.uri,
    id: artist.id,
    name: artist.name,
    url: artist.external_urls.spotify,
    imageUrl: pickArtistImage(artist, 160)?.url ?? null,
  };
}

/**
 * Follows artists. February 2026 replaced `PUT /me/following` with the unified
 * library endpoint, which takes URIs instead of ids.
 *
 * The migration guide shows the URIs in a JSON body, but the API has answered
 * `400 Missing required field: uris` to that, so if the body form is rejected
 * the same call is retried with the URIs in the query string (the shape the old
 * follow endpoint used). Whichever works is logged once.
 */
export async function followSpotifyArtists(
  accessToken: string,
  uris: string[],
): Promise<void> {
  const wanted = uris.slice(0, 50);

  try {
    await spotifyFetch("/me/library", accessToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris: wanted }),
    });
    return;
  } catch (error) {
    const missingField =
      error instanceof SpotifyApiError &&
      error.status === 400 &&
      /uris/i.test(error.message);
    if (!missingField) throw error;

    console.info(
      "[spotify] PUT /me/library rejected the JSON body; retrying with the URIs in the query string.",
    );
  }

  const params = new URLSearchParams({ uris: wanted.join(",") });
  await spotifyFetch(`/me/library?${params}`, accessToken, { method: "PUT" });
}


/* ------------------------------------------------------------------ */
/* Artists behind the songs (the "played but not followed" list)       */
/* ------------------------------------------------------------------ */

/**
 * One credited artist of one song, with the id Spotify knows them by.
 *
 * Matching on ids rather than names is what makes this list exact: the same
 * artist can be spelled differently across tracks, and two different artists
 * can share a name.
 */
export type TrackArtistRef = {
  id: string;
  name: string;
  uri: string;
  url: string;
};

/**
 * A page of credits. `artists` keeps the duplicates on purpose: an artist
 * appearing in ten songs has to be counted ten times.
 */
export type ArtistRefsPage = {
  artists: TrackArtistRef[];
  /** Offset of the next page. null when there are no more. */
  nextOffset: number | null;
  total: number;
};

/**
 * Every artist credited on one song, each one once. Podcast episodes have none.
 *
 * The de-duplication matters: a song crediting the same artist twice would
 * otherwise count double in the tally.
 */
function toArtistRefs(media: RawMedia): TrackArtistRef[] {
  if (!media || media.type === "episode") return [];

  const refs: TrackArtistRef[] = [];
  const seen = new Set<string>();

  for (const artist of media.artists ?? []) {
    // An artist without an id cannot be followed or told apart, so skip it.
    if (!artist?.id || !artist.name || seen.has(artist.id)) continue;
    seen.add(artist.id);
    refs.push({
      id: artist.id,
      name: artist.name,
      uri: artist.uri ?? `spotify:artist:${artist.id}`,
      url:
        artist.external_urls?.spotify ??
        `https://open.spotify.com/artist/${artist.id}`,
    });
  }
  return refs;
}

function toArtistRefsPage(data: {
  items: RawPlaylistItem[];
  next: string | null;
  offset: number;
  total: number;
}): ArtistRefsPage {
  const artists: TrackArtistRef[] = [];
  for (const entry of data.items) {
    artists.push(...toArtistRefs(entry.item ?? entry.track ?? null));
  }

  return {
    artists,
    // Based on the raw page length, so songs without credits never stall it.
    nextOffset: data.next ? data.offset + data.items.length : null,
    total: data.total,
  };
}

/** The artists credited on one page of a playlist. */
export async function getPlaylistArtistRefs(
  accessToken: string,
  playlistId: string,
  { offset = 0 }: { offset?: number } = {},
): Promise<ArtistRefsPage> {
  const params = new URLSearchParams({
    limit: "50",
    offset: String(Math.max(offset, 0)),
    additional_types: "track,episode",
  });

  const response = await spotifyFetch(
    `/playlists/${encodeURIComponent(playlistId)}/items?${params}`,
    accessToken,
  );
  return toArtistRefsPage(
    (await response.json()) as {
      items: RawPlaylistItem[];
      next: string | null;
      offset: number;
      total: number;
    },
  );
}

/**
 * The artists credited on one page of the liked songs. Needs the
 * `user-library-read` scope, which sessions created before it was added do not
 * have; Spotify answers 403 and the caller reports it as a missing permission.
 */
export async function getSavedTrackArtistRefs(
  accessToken: string,
  { offset = 0 }: { offset?: number } = {},
): Promise<ArtistRefsPage> {
  const params = new URLSearchParams({
    limit: "50",
    offset: String(Math.max(offset, 0)),
  });

  const response = await spotifyFetch(`/me/tracks?${params}`, accessToken);
  return toArtistRefsPage(
    (await response.json()) as {
      items: RawPlaylistItem[];
      next: string | null;
      offset: number;
      total: number;
    },
  );
}

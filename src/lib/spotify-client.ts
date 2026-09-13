/**
 * Browser-side fetchers. They walk our own `/api/spotify/*` routes, which are the
 * only place the access token lives: it never reaches the client, it travels in
 * the session cookie.
 *
 * The pagination logic mirrors `getAllFollowedArtists` / `getAllUserPlaylists`
 * from `@/lib/spotify`, but over our routes instead of the Spotify API.
 */

import type {
  ExportedTrack,
  FollowedArtistsPage,
  PlaylistsPage,
  PlaylistTracksPage,
  SpotifyArtist,
  SpotifyPlaylist,
} from "@/lib/spotify";

/** The route answered 401: the Spotify session is gone and the user has to sign in again. */
export class SessionExpiredError extends Error {
  constructor(message = "The Spotify session expired") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

/** The route answered 403: the token was issued before we requested a scope we now need. */
export class MissingScopeError extends Error {
  constructor(message = "A Spotify permission is missing") {
    super(message);
    this.name = "MissingScopeError";
  }
}

/** Same safety cap as the server: 50 items * 200 pages = 10,000. */
const MAX_PAGES = 200;

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });

  // The error routes always answer JSON, but never trust that under a proxy.
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;

  if (response.status === 401) throw new SessionExpiredError(body?.error);
  if (response.status === 403) throw new MissingScopeError(body?.error);

  if (!response.ok) {
    throw new Error(body?.error ?? `Spotify request failed (${response.status})`);
  }

  if (!body) throw new Error("Spotify returned an empty response");

  return body;
}

/** Every followed artist, walking the cursor pagination of `/api/spotify/following`. */
export async function fetchAllFollowedArtists(
  signal?: AbortSignal,
): Promise<SpotifyArtist[]> {
  const all: SpotifyArtist[] = [];
  const seen = new Set<string>();
  let after: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const query = after ? `?after=${encodeURIComponent(after)}` : "";
    const data: FollowedArtistsPage = await getJson<FollowedArtistsPage>(
      `/api/spotify/following${query}`,
      signal,
    );

    for (const artist of data.items) {
      // Guard against a cursor that does not advance: never duplicate an artist.
      if (seen.has(artist.id)) continue;
      seen.add(artist.id);
      all.push(artist);
    }

    if (!data.nextCursor || data.nextCursor === after) break;
    after = data.nextCursor;
  }

  return all;
}

/** Every playlist, walking the offset pagination of `/api/spotify/playlists`. */
export async function fetchAllUserPlaylists(
  signal?: AbortSignal,
): Promise<SpotifyPlaylist[]> {
  const all: SpotifyPlaylist[] = [];
  const seen = new Set<string>();
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data: PlaylistsPage = await getJson<PlaylistsPage>(
      `/api/spotify/playlists?offset=${offset}`,
      signal,
    );

    for (const playlist of data.items) {
      if (seen.has(playlist.id)) continue;
      seen.add(playlist.id);
      all.push(playlist);
    }

    if (data.nextOffset === null || data.nextOffset === offset) break;
    offset = data.nextOffset;
  }

  return all;
}

/** Every track of one playlist, walking the offset pagination (100 per page). */
export async function fetchAllPlaylistTracks(
  playlistId: string,
  signal?: AbortSignal,
): Promise<ExportedTrack[]> {
  const all: ExportedTrack[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data: PlaylistTracksPage = await getJson<PlaylistTracksPage>(
      `/api/spotify/playlists/${encodeURIComponent(playlistId)}/tracks?offset=${offset}`,
      signal,
    );

    // Pushed one by one: spreading a few thousand items can overflow the stack.
    for (const track of data.items) all.push(track);

    if (data.nextOffset === null || data.nextOffset === offset) break;
    offset = data.nextOffset;
  }

  return all;
}

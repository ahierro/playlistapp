import type { ExportedTrack, TracksPage } from "@/lib/music";
import { nameCollator } from "@/lib/music";
import { cleanChannelName, parseYouTubeTrack } from "@/lib/youtube-track-parser";

/**
 * Server-side client for the YouTube Data API v3, which is how we read a
 * YouTube Music library (YouTube Music has no public API of its own).
 *
 * Quota: every `list` call below costs 1 unit out of the default 10,000 a day
 * per Google Cloud project, so even large libraries stay far below the limit.
 */
const API_BASE = "https://www.googleapis.com/youtube/v3";

/** The access token is no longer usable (expired / revoked). */
export class YouTubeAuthError extends Error {
  constructor(message = "The YouTube session is not valid") {
    super(message);
    this.name = "YouTubeAuthError";
  }
}

export class YouTubeApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "YouTubeApiError";
    this.status = status;
  }
}

type GoogleErrorBody = {
  error?: {
    message?: string;
    errors?: { reason?: string; message?: string }[];
  };
};

const QUOTA_REASONS = new Set([
  "quotaExceeded",
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "dailyLimitExceeded",
]);

export async function youtubeFetch<T>(
  path: string,
  params: Record<string, string | undefined>,
  accessToken: string,
): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, value);
  }

  const response = await fetch(`${API_BASE}${path}?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (response.ok) return (await response.json()) as T;

  if (response.status === 401) throw new YouTubeAuthError();

  const body = (await response.json().catch(() => null)) as GoogleErrorBody | null;
  const reason = body?.error?.errors?.[0]?.reason ?? "";
  const detail = body?.error?.message ?? `HTTP ${response.status}`;

  // Google reports quota problems as 403; surface them as a rate limit so the UI
  // does not tell the user to sign in again for nothing.
  if (QUOTA_REASONS.has(reason)) {
    throw new YouTubeApiError(
      `The YouTube Data API quota is exhausted (${reason}). It resets daily at midnight Pacific time.`,
      429,
    );
  }

  if (response.status === 403) {
    throw new YouTubeApiError(
      reason === "insufficientPermissions" || reason === "forbidden"
        ? `YouTube rejected the request (${reason}). Sign in again and make sure the YouTube permission is ticked on the Google consent screen.`
        : `YouTube rejected the request (${reason || 403}): ${detail}`,
      403,
    );
  }

  if (response.status === 404 && reason === "channelNotFound") {
    throw new YouTubeApiError(
      "This Google account has no YouTube channel yet. Open YouTube once with it to create one.",
      404,
    );
  }

  throw new YouTubeApiError(
    `YouTube Data API error (${response.status}${reason ? `, ${reason}` : ""}): ${detail}`,
    response.status,
  );
}

type Thumbnail = { url: string; width?: number; height?: number };
type Thumbnails = Partial<
  Record<"default" | "medium" | "high" | "standard" | "maxres", Thumbnail>
>;

/** The raw objects stay on the server; the routes answer with these shapes. */
export type YouTubeImage = { url: string; width: number | null; height: number | null };

function toImages(thumbnails: Thumbnails | undefined): YouTubeImage[] {
  return Object.values(thumbnails ?? {})
    .filter((thumb): thumb is Thumbnail => Boolean(thumb?.url))
    .map((thumb) => ({
      url: thumb.url,
      width: thumb.width ?? null,
      height: thumb.height ?? null,
    }));
}

type PagedResponse<T> = {
  items?: T[];
  nextPageToken?: string;
  pageInfo?: { totalResults?: number };
};

/* ------------------------------------------------------------------ */
/* Playlists                                                           */
/* ------------------------------------------------------------------ */

export type YouTubePlaylist = {
  id: string;
  title: string;
  channelId: string | null;
  channelTitle: string | null;
  privacyStatus: "public" | "unlisted" | "private" | null;
  itemCount: number | null;
  images: YouTubeImage[];
  /** The "Liked videos" system playlist, which `mine=true` never lists. */
  isLikes?: true;
};

export type YouTubePlaylistsPage = {
  items: YouTubePlaylist[];
  nextPageToken: string | null;
};

type RawPlaylist = {
  id: string;
  snippet?: { title?: string; channelId?: string; channelTitle?: string; thumbnails?: Thumbnails };
  status?: { privacyStatus?: YouTubePlaylist["privacyStatus"] };
  contentDetails?: { itemCount?: number };
};

function toPlaylist(raw: RawPlaylist): YouTubePlaylist {
  return {
    id: raw.id,
    title: raw.snippet?.title ?? "Untitled playlist",
    channelId: raw.snippet?.channelId ?? null,
    channelTitle: raw.snippet?.channelTitle ?? null,
    privacyStatus: raw.status?.privacyStatus ?? null,
    itemCount: raw.contentDetails?.itemCount ?? null,
    images: toImages(raw.snippet?.thumbnails),
  };
}

/**
 * The user's "Liked videos" playlist. YouTube Music's "Liked music" (LM) is not
 * reachable through the Data API, but every liked song is also a liked video.
 */
async function getLikesPlaylist(accessToken: string): Promise<YouTubePlaylist | null> {
  const channels = await youtubeFetch<{
    items?: {
      id: string;
      snippet?: { title?: string };
      contentDetails?: { relatedPlaylists?: { likes?: string } };
    }[];
  }>("/channels", { part: "snippet,contentDetails", mine: "true" }, accessToken);

  const channel = channels.items?.[0];
  const likesId = channel?.contentDetails?.relatedPlaylists?.likes;
  if (!channel || !likesId) return null;

  return {
    id: likesId,
    title: "Liked videos",
    channelId: channel.id,
    channelTitle: channel.snippet?.title ?? null,
    privacyStatus: "private",
    itemCount: null,
    images: [],
    isLikes: true,
  };
}

/**
 * One page of the user's own playlists. Paginates by page token.
 * The first page also carries the "Liked videos" playlist.
 */
export async function getYouTubePlaylists(
  accessToken: string,
  { pageToken }: { pageToken?: string | null } = {},
): Promise<YouTubePlaylistsPage> {
  const [data, likes] = await Promise.all([
    youtubeFetch<PagedResponse<RawPlaylist>>(
      "/playlists",
      {
        part: "snippet,contentDetails,status",
        mine: "true",
        maxResults: "50",
        pageToken: pageToken ?? undefined,
      },
      accessToken,
    ),
    pageToken
      ? Promise.resolve(null)
      : getLikesPlaylist(accessToken).catch((error) => {
          // Never lose the real playlists because of the extra one.
          console.error("[youtube] Could not read the liked videos playlist", error);
          return null;
        }),
  ]);

  const items = (data.items ?? []).map(toPlaylist);
  if (likes) items.unshift(likes);

  return { items, nextPageToken: data.nextPageToken ?? null };
}

/* ------------------------------------------------------------------ */
/* Playlist items                                                      */
/* ------------------------------------------------------------------ */

type RawPlaylistItem = {
  snippet?: {
    title?: string;
    description?: string;
    videoOwnerChannelTitle?: string;
  };
};

/** One page of a playlist's contents, already parsed into songs. */
export async function getYouTubePlaylistItems(
  accessToken: string,
  playlistId: string,
  { pageToken }: { pageToken?: string | null } = {},
): Promise<TracksPage> {
  let data: PagedResponse<RawPlaylistItem>;

  try {
    data = await youtubeFetch<PagedResponse<RawPlaylistItem>>(
      "/playlistItems",
      {
        part: "snippet",
        playlistId,
        maxResults: "50",
        pageToken: pageToken ?? undefined,
      },
      accessToken,
    );
  } catch (error) {
    // A playlist that vanished or cannot be read is skipped by the export, the
    // same way Spotify's 403 is: report it as a 403.
    if (error instanceof YouTubeApiError && error.status === 404) {
      throw new YouTubeApiError(
        `YouTube could not find or read playlist ${playlistId}.`,
        403,
      );
    }
    throw error;
  }

  const items: ExportedTrack[] = [];
  for (const entry of data.items ?? []) {
    const track = entry.snippet ? parseYouTubeTrack(entry.snippet) : null;
    if (track) items.push(track);
  }

  return { items, next: data.nextPageToken ?? null };
}

/* ------------------------------------------------------------------ */
/* Artists (channel subscriptions)                                     */
/* ------------------------------------------------------------------ */

export type YouTubeArtist = {
  /** Channel id. */
  id: string;
  name: string;
  genres: string[];
  images: YouTubeImage[];
};

export type YouTubeArtistsPage = {
  items: YouTubeArtist[];
  nextPageToken: string | null;
  /** Subscriptions looked at on this page, before the artist filter. */
  scanned: number;
  /** Total subscriptions YouTube reports for the account. */
  totalSubscriptions: number | null;
};

/**
 * Freebase topics YouTube assigns to music channels, as Wikipedia URLs.
 * https://developers.google.com/youtube/v3/docs/channels#topicDetails
 */
const MUSIC_TOPICS = new Set([
  "Music",
  "Christian_music",
  "Classical_music",
  "Country_music",
  "Electronic_music",
  "Hip_hop_music",
  "Independent_music",
  "Jazz",
  "Music_of_Asia",
  "Music_of_Latin_America",
  "Pop_music",
  "Reggae",
  "Rhythm_and_blues",
  "Rock_music",
  "Soul_music",
]);

export function topicName(url: string): string {
  return decodeURIComponent(url.split("/wiki/").at(-1) ?? "");
}

type RawSubscription = {
  snippet?: {
    title?: string;
    thumbnails?: Thumbnails;
    resourceId?: { channelId?: string };
  };
};

type RawChannel = {
  id: string;
  topicDetails?: { topicCategories?: string[] };
};

/**
 * Whether a subscribed channel looks like an artist. YouTube has no "follow
 * artist" concept, so this is a heuristic:
 * - auto-generated "Name - Topic" channels and "NameVEVO" channels, or
 * - channels YouTube itself tagged with a music topic.
 * A music reviewer or a label can slip in, and an artist YouTube never tagged can
 * be left out.
 */
export function isArtistChannel(title: string, topics: string[]): boolean {
  if (/\s-\s+topic$/iu.test(title) || /vevo$/iu.test(title)) return true;
  return topics.some((topic) => MUSIC_TOPICS.has(topic));
}

/**
 * One page of subscriptions, filtered down to artist channels. A page can come
 * back with fewer than 50 items (or none) and still have a next page.
 */
export async function getYouTubeArtists(
  accessToken: string,
  { pageToken }: { pageToken?: string | null } = {},
): Promise<YouTubeArtistsPage> {
  const subscriptions = await youtubeFetch<PagedResponse<RawSubscription>>(
    "/subscriptions",
    {
      part: "snippet",
      mine: "true",
      maxResults: "50",
      // No `order`: the client sorts by the cleaned name anyway, and the default
      // order is the one YouTube paginates most reliably.
      pageToken: pageToken ?? undefined,
    },
    accessToken,
  );

  const subscribed = (subscriptions.items ?? []).flatMap((item) => {
    const id = item.snippet?.resourceId?.channelId;
    return id ? [{ id, snippet: item.snippet! }] : [];
  });

  const topicsById = new Map<string, string[]>();
  if (subscribed.length > 0) {
    const channels = await youtubeFetch<PagedResponse<RawChannel>>(
      "/channels",
      {
        part: "topicDetails",
        id: subscribed.map((channel) => channel.id).join(","),
        maxResults: "50",
      },
      accessToken,
    );

    for (const channel of channels.items ?? []) {
      topicsById.set(
        channel.id,
        (channel.topicDetails?.topicCategories ?? []).map(topicName),
      );
    }
  }

  const items: YouTubeArtist[] = [];
  for (const { id, snippet } of subscribed) {
    const title = snippet.title ?? "";
    const topics = topicsById.get(id) ?? [];
    if (!title || !isArtistChannel(title, topics)) continue;

    items.push({
      id,
      name: cleanChannelName(title),
      genres: topics
        .filter((topic) => MUSIC_TOPICS.has(topic) && topic !== "Music")
        .map((topic) => topic.replace(/_/g, " ").toLowerCase()),
      images: toImages(snippet.thumbnails),
    });
  }

  const totalSubscriptions = subscriptions.pageInfo?.totalResults ?? null;

  // Visible in the `npm run dev` terminal: tells a short list caused by the
  // artist filter apart from one caused by pagination stopping early.
  console.info(
    `[youtube] subscriptions page: ${subscribed.length} scanned, ${items.length} kept as artists, ` +
      `${totalSubscriptions ?? "?"} total, ${subscriptions.nextPageToken ? "more pages" : "last page"}`,
  );

  return {
    items,
    nextPageToken: subscriptions.nextPageToken ?? null,
    scanned: subscribed.length,
    totalSubscriptions,
  };
}

/**
 * A user subscribed to both "Adele" and "Adele - Topic" should see Adele once.
 * Keeps the first channel per name (callers pass the official one first when
 * they can) and merges the genres.
 */
export function dedupeArtistsByName<
  T extends { name: string; genres: string[] },
>(artists: T[]): T[] {
  const byName = new Map<string, T>();

  for (const artist of artists) {
    const key = artist.name.normalize("NFKD").toLowerCase().trim();
    const existing = byName.get(key);

    if (!existing) {
      byName.set(key, { ...artist });
      continue;
    }

    existing.genres = [...new Set([...existing.genres, ...artist.genres])];
  }

  return [...byName.values()];
}

/** Every artist channel, walking the page tokens. Same safety cap as Spotify. */
export async function getAllYouTubeArtists(
  accessToken: string,
  { maxPages = 200 }: { maxPages?: number } = {},
): Promise<YouTubeArtist[]> {
  const all: YouTubeArtist[] = [];
  let pageToken: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const data: YouTubeArtistsPage = await getYouTubeArtists(accessToken, {
      pageToken,
    });
    for (const artist of data.items) all.push(artist);

    if (!data.nextPageToken || data.nextPageToken === pageToken) break;
    pageToken = data.nextPageToken;
  }

  return dedupeArtistsByName(all).sort((a, b) =>
    nameCollator.compare(a.name, b.name),
  );
}

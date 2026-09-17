import type { ExportedTrack, TracksPage } from "@/lib/music";
import { nameCollator } from "@/lib/music";
import {
  buildSearchQuery,
  parseIsoDuration,
  pickBestMatch,
  type MatchQuery,
  type ScoredCandidate,
  type VideoCandidate,
} from "@/lib/youtube-match";
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
  { method = "GET", body }: { method?: "GET" | "POST" | "DELETE"; body?: unknown } = {},
): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, value);
  }

  const response = await fetch(`${API_BASE}${path}?${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });

  // DELETE answers 204 with no body.
  if (response.status === 204) return undefined as T;
  if (response.ok) return (await response.json()) as T;

  if (response.status === 401) throw new YouTubeAuthError();

  const errorBody = (await response.json().catch(() => null)) as GoogleErrorBody | null;
  const reason = errorBody?.error?.errors?.[0]?.reason ?? "";
  const detail = errorBody?.error?.message ?? `HTTP ${response.status}`;

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

  if (response.status === 404 && reason === "videoNotFound") {
    throw new YouTubeApiError("YouTube could not find that video.", 404);
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
  /**
   * Share (0-1) of music among the first 50 videos, or null when there is
   * nothing to judge (empty playlist, or only deleted/private videos).
   */
  musicShare: number | null;
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
    musicShare: null,
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
    musicShare: null,
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

  await mapWithConcurrency(items, 8, async (playlist) => {
    try {
      playlist.musicShare = await getMusicShare(accessToken, playlist.id);
    } catch (error) {
      // Unknown is treated as music by the UI, so a failure never hides a playlist.
      console.error(`[youtube] Could not classify playlist ${playlist.id}`, error);
    }
  });

  return { items, nextPageToken: data.nextPageToken ?? null };
}

/** YouTube's "Music" video category. */
const MUSIC_CATEGORY_ID = "10";

/**
 * YouTube and YouTube Music share one set of playlists, and the API has no
 * field telling where a playlist was made. The best available signal is its
 * content: the share of videos in the Music category or from an auto-generated
 * "Artist - Topic" channel, over the first 50 entries. Costs 2 quota units.
 */
async function getMusicShare(
  accessToken: string,
  playlistId: string,
): Promise<number | null> {
  const page = await youtubeFetch<
    PagedResponse<{
      snippet?: { videoOwnerChannelTitle?: string };
      contentDetails?: { videoId?: string };
    }>
  >(
    "/playlistItems",
    { part: "snippet,contentDetails", playlistId, maxResults: "50" },
    accessToken,
  );

  const entries = (page.items ?? []).flatMap((item) =>
    item.contentDetails?.videoId && item.snippet?.videoOwnerChannelTitle
      ? [
          {
            videoId: item.contentDetails.videoId,
            isTopic: /\s-\s+topic$/i.test(item.snippet.videoOwnerChannelTitle),
          },
        ]
      : [],
  );
  if (entries.length === 0) return null;

  const categories = new Map<string, string | undefined>();
  const needCategory = entries.filter((entry) => !entry.isTopic);
  if (needCategory.length > 0) {
    const videos = await youtubeFetch<
      PagedResponse<{ id: string; snippet?: { categoryId?: string } }>
    >(
      "/videos",
      {
        part: "snippet",
        id: needCategory.map((entry) => entry.videoId).join(","),
        maxResults: "50",
      },
      accessToken,
    );
    for (const video of videos.items ?? []) {
      categories.set(video.id, video.snippet?.categoryId);
    }
  }

  const music = entries.filter(
    (entry) =>
      entry.isTopic || categories.get(entry.videoId) === MUSIC_CATEGORY_ID,
  ).length;
  return music / entries.length;
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await task(items[next++]);
  });
  await Promise.all(workers);
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
/**
 * `subscriptions.list` stops handing out page tokens after roughly 1,000 items
 * (20 pages), whatever the account really has. Each `order` returns a different
 * slice, so walking all three and merging them reaches far more of a large
 * subscription list. It is still not guaranteed to be complete beyond ~3,000.
 */
export const SUBSCRIPTION_ORDERS = ["relevance", "alphabetical", "unread"] as const;
export type SubscriptionOrder = (typeof SUBSCRIPTION_ORDERS)[number];

export async function getYouTubeArtists(
  accessToken: string,
  {
    pageToken,
    order = "relevance",
  }: { pageToken?: string | null; order?: SubscriptionOrder } = {},
): Promise<YouTubeArtistsPage> {
  const subscriptions = await youtubeFetch<PagedResponse<RawSubscription>>(
    "/subscriptions",
    {
      part: "snippet",
      mine: "true",
      maxResults: "50",
      order,
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
  const seen = new Set<string>();

  for (const order of SUBSCRIPTION_ORDERS) {
    let pageToken: string | null = null;

    for (let page = 0; page < maxPages; page++) {
      const data: YouTubeArtistsPage = await getYouTubeArtists(accessToken, {
        pageToken,
        order,
      });
      for (const artist of data.items) {
        if (seen.has(artist.id)) continue;
        seen.add(artist.id);
        all.push(artist);
      }

      if (!data.nextPageToken || data.nextPageToken === pageToken) break;
      pageToken = data.nextPageToken;
    }
  }

  return dedupeArtistsByName(all).sort((a, b) =>
    nameCollator.compare(a.name, b.name),
  );
}

/* ------------------------------------------------------------------ */
/* Writing: used by the Spotify -> YouTube Music copy                  */
/* ------------------------------------------------------------------ */

/**
 * Quota cost of each call below, in units of the default 10,000/day:
 * search.list 100, videos.list 1, playlists.insert 50,
 * playlistItems.insert 50, playlistItems.delete 50, playlistItems.list 1.
 */

export type PrivacyStatus = "private" | "unlisted" | "public";

export type CreatedPlaylist = { id: string; title: string };

export async function createYouTubePlaylist(
  accessToken: string,
  {
    title,
    description,
    privacyStatus,
  }: { title: string; description?: string; privacyStatus: PrivacyStatus },
): Promise<CreatedPlaylist> {
  const data = await youtubeFetch<{ id: string; snippet?: { title?: string } }>(
    "/playlists",
    { part: "snippet,status" },
    accessToken,
    {
      method: "POST",
      body: {
        // YouTube caps titles at 150 characters and descriptions at 5,000, and
        // rejects "<" and ">" in both.
        snippet: {
          title: title.replace(/[<>]/g, "").slice(0, 150),
          description: (description ?? "").replace(/[<>]/g, "").slice(0, 5000),
        },
        status: { privacyStatus },
      },
    },
  );

  return { id: data.id, title: data.snippet?.title ?? title };
}

export type AddedItem = {
  /** The playlist item id, needed to remove it again. */
  itemId: string;
  videoId: string;
  title: string;
  channelTitle: string;
};

export async function addVideoToPlaylist(
  accessToken: string,
  playlistId: string,
  videoId: string,
): Promise<AddedItem> {
  const data = await youtubeFetch<{
    id: string;
    snippet?: { title?: string; videoOwnerChannelTitle?: string };
  }>("/playlistItems", { part: "snippet" }, accessToken, {
    method: "POST",
    body: {
      snippet: {
        playlistId,
        resourceId: { kind: "youtube#video", videoId },
      },
    },
  });

  return {
    itemId: data.id,
    videoId,
    title: data.snippet?.title ?? "",
    channelTitle: data.snippet?.videoOwnerChannelTitle ?? "",
  };
}

export async function removePlaylistItem(
  accessToken: string,
  itemId: string,
): Promise<void> {
  await youtubeFetch<void>("/playlistItems", { id: itemId }, accessToken, {
    method: "DELETE",
  });
}

export type VideoIdsPage = {
  videoIds: string[];
  nextPageToken: string | null;
};

/** Video ids already in a playlist, so a copy into it never adds duplicates. */
export async function getPlaylistVideoIds(
  accessToken: string,
  playlistId: string,
  { pageToken }: { pageToken?: string | null } = {},
): Promise<VideoIdsPage> {
  const data = await youtubeFetch<
    PagedResponse<{ contentDetails?: { videoId?: string } }>
  >(
    "/playlistItems",
    {
      part: "contentDetails",
      playlistId,
      maxResults: "50",
      pageToken: pageToken ?? undefined,
    },
    accessToken,
  );

  return {
    videoIds: (data.items ?? []).flatMap((item) =>
      item.contentDetails?.videoId ? [item.contentDetails.videoId] : [],
    ),
    nextPageToken: data.nextPageToken ?? null,
  };
}

export type TrackMatch = {
  match: ScoredCandidate | null;
  query: string;
};

/**
 * Searches YouTube for a track and picks the best video. Costs 101 units: the
 * search plus one `videos.list` for the durations of the candidates.
 */
export async function findTrackOnYouTube(
  accessToken: string,
  track: MatchQuery,
): Promise<TrackMatch> {
  const query = buildSearchQuery(track);

  const search = await youtubeFetch<
    PagedResponse<{
      id?: { videoId?: string };
      snippet?: { title?: string; channelTitle?: string };
    }>
  >(
    "/search",
    {
      part: "snippet",
      q: query,
      type: "video",
      // Category 10 is "Music"; it drops most tutorials and reactions.
      videoCategoryId: "10",
      maxResults: "8",
    },
    accessToken,
  );

  const candidates: VideoCandidate[] = (search.items ?? []).flatMap((item) =>
    item.id?.videoId
      ? [
          {
            videoId: item.id.videoId,
            // search.list returns HTML-escaped titles.
            title: decodeEntities(item.snippet?.title ?? ""),
            channelTitle: decodeEntities(item.snippet?.channelTitle ?? ""),
            durationSeconds: null,
          },
        ]
      : [],
  );

  if (candidates.length > 0 && track.durationMs) {
    const videos = await youtubeFetch<
      PagedResponse<{ id: string; contentDetails?: { duration?: string } }>
    >(
      "/videos",
      {
        part: "contentDetails",
        id: candidates.map((candidate) => candidate.videoId).join(","),
        maxResults: "50",
      },
      accessToken,
    );
    const durations = new Map(
      (videos.items ?? []).map((video) => [
        video.id,
        parseIsoDuration(video.contentDetails?.duration),
      ]),
    );
    for (const candidate of candidates) {
      candidate.durationSeconds = durations.get(candidate.videoId) ?? null;
    }
  }

  return { match: pickBestMatch(track, candidates), query };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

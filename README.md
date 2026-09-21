# Playlist App

A Next.js (App Router) + React app that lets you sign in with **Spotify**, **YouTube Music** or both at the same time, and lists your artists and playlists (with a JSON export of the playlists' tracks).

## Stack

- **Next.js 16** (App Router, Server Components, route handlers)
- **React 19**
- **Auth.js v5** (`next-auth@beta`): two independent instances (Spotify and Google), both with automatic token refresh
- **Tailwind CSS v4** + **shadcn/ui** components
- **TypeScript**, strict

## Getting started

### 1. Create the app on Spotify

1. Go to <https://developer.spotify.com/dashboard> and create an app.
2. Under **Redirect URIs** add exactly:

   ```
   http://127.0.0.1:3000/api/auth/callback/spotify
   ```

   > **Important:** Spotify **does not accept `localhost`** as a redirect URI, you have to use the literal IP `127.0.0.1`. That is why the dev server must be opened at `http://127.0.0.1:3000` and not at `http://localhost:3000` (otherwise the OAuth `state` ends up on a different domain and the callback fails).

3. Under **APIs used** check **Web API**.
4. Copy the **Client ID** and the **Client Secret**.

### ⚠️ Development Mode after February 2026

Spotify [tightened developer access](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security).
Every new app is created under these rules:

| Rule | Detail |
| --- | --- |
| **Spotify Premium** | The app owner needs an active Premium subscription. |
| **Client IDs** | 1 per developer (raised to 25 in July 2026). |
| **Authorized users** | Up to **5**, added by hand under **Settings → User Management**. Any other account gets a `403`. |
| **Endpoints** | Only the [February 2026 supported set](https://developer.spotify.com/documentation/web-api/references/changes/february-2026). |

Development Mode is a sandbox for learning and personal projects, not a foundation for
scaling a product.

#### What of this affects this app

- `GET /me/following` (followed artists) and `GET /me` (profile) **are still supported**. The core works.
- The **Artist** object lost `followers` and `popularity`. `src/lib/spotify.ts` declares them optional and
  `ArtistCard` only shows them if they arrive, so it does not break in either case.
- The **User** object lost `email`, `country`, `product`, `explicit_content` and `followers`. That is why
  **we do not request the `user-read-email` scope** and the header shows only the display name and the picture.
- `PUT`/`DELETE /me/following` (follow and unfollow) were removed and replaced by the
  unified `PUT`/`DELETE /me/library` endpoints, which take URIs instead of IDs. Worth keeping in mind if
  you later want to add "unfollow" from the app.

### 1b. Create the Google OAuth client (YouTube Music)

YouTube Music has **no public API**. Its library lives on the YouTube account, so the app
reads it through the official **YouTube Data API v3** after a Google sign-in.

1. Go to <https://console.cloud.google.com/>, create (or pick) a project.
2. **APIs & Services → Library**: enable **YouTube Data API v3**.
3. **APIs & Services → OAuth consent screen**: type *External*, fill in the app name and your
   e-mail, add the scope `.../auth/youtube` (*Manage your YouTube account*; needed to create
   playlists, and it also covers reading).
   In the newer console these settings live under **Google Auth Platform**: *Branding* (app
   name, e-mail), *Data Access* (scopes) and **Audience**.
   Under **Audience → Test users → + Add users**, add every Google account that will sign in
   (up to 100 while *Publishing status* is *Testing*). You can do this at any time; without it
   Google answers `Error 403: access_denied`.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** and fill in the form:

   | Field | What to put |
   | --- | --- |
   | **Application type** | `Web application` |
   | **Name** | Anything (e.g. `Playlist App dev`). Only you see it. |
   | **Authorized JavaScript origins** | **Leave it empty.** It is only for sign-in done from browser JavaScript; this app exchanges the code on the server. |
   | **Authorized redirect URIs** | This is the **second** section of the form, further down. Click **its** **+ Add URI** and paste exactly the line below. |

   ```
   http://127.0.0.1:3000/api/youtube-auth/callback/google
   ```

   - If Google shows *"Invalid Origin: URIs must not contain a path or end with "/""*, you
     pasted it under **Authorized JavaScript origins** by mistake. Delete that entry and add it
     under **Authorized redirect URIs** instead.
   - It must match character by character: `http` (not `https`), `127.0.0.1` (not `localhost`),
     port `3000`, no trailing slash. It is the same origin the Spotify login uses
     (`AUTH_DEV_ORIGIN`), with `/api/youtube-auth/...` instead of `/api/auth/...`.
   - Google accepts plain `http` here only because `127.0.0.1` is a loopback address.
   - If you run the dev server on another port, change the port here and in `AUTH_DEV_ORIGIN`.
   - Click **Create**. Changes can take a few minutes to apply; a `redirect_uri_mismatch` right
     after saving usually means "wait and retry".

5. The dialog that opens shows the **Client ID** (ends in `.apps.googleusercontent.com`) and the
   **Client secret** (starts with `GOCSPX-`). Copy both right away, or click **Download JSON**:
   Google may not show the secret again, and if you lose it you have to add a new one to the client.
   Put them in `.env.local` (or `.env`) as `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`, without quotes,
   and restart `npm run dev`.

#### Limits worth knowing

| Topic | Detail |
| --- | --- |
| **Testing mode** | Refresh tokens expire after **7 days**; after that the app asks you to sign in to YouTube Music again. Publishing the app removes that, but `youtube` is a sensitive scope and needs Google verification. |
| **Quota** | 10,000 units/day per project. Reading costs 1 unit per call (50 items per call), so a normal library uses a few dozen. Writing is expensive: creating a playlist or adding one video costs **50 units**, and a `search` costs **100**, so a day's quota covers roughly 200 inserted videos, or about 60 if each one has to be searched first. |
| **Granular consent** | Google lets you untick the YouTube permission. If you do, the lists show a "permission is missing" card: sign out of YouTube Music and in again, keeping it ticked. |
| **Brand accounts** | The data comes from the channel selected during sign-in. If your music is on a brand account, pick that one on Google's account chooser. |

#### What you get from YouTube Music

- **Playlists**: every playlist you own (`playlists?mine=true`) plus **Liked videos**. YouTube
  Music's *Liked music* and playlists you only saved from others are not exposed by the API.
- **Tracks** in the export: YouTube returns videos, not songs. For auto-generated "Topic" videos
  (most album tracks in YouTube Music) the song, every artist and the album are read from the
  machine-written description. For any other video, the title is split on `Artist - Song` and
  noise such as `(Official Video)` is removed; `album` is `null` there
  (`src/lib/youtube-track-parser.ts`).
- **Artists**: YouTube has no "follow artist", so the app lists your **channel subscriptions that
  look like artists**: `Name - Topic` and `NameVEVO` channels, or channels YouTube tagged with a
  music topic **whose last 10 uploads are at least 60% songs**: Music category and no longer than
  10 minutes (this drops reviewers, reaction, podcast and gear channels; a single concert or full
  album does not disqualify an artist, it just does not count as a song). A channel with fewer than 3 uploads is kept only if its
  topic is a specific genre. It is still a heuristic, and duplicates such as
  `Adele` / `Adele - Topic` are merged. Checking uploads costs about 1-2 quota units per channel;
  verdicts are cached in server memory for a week.
  Both artist pages load in batches of 20 as you scroll (`src/lib/artist-pager.ts`): walking
  everything up front took too long. The **.txt download** is what fetches the complete list: the
  browser walks every page itself, showing a progress bar (and a Cancel button), saves the result
  in `localStorage` — so from then on the page opens with every artist straight from the cache —
  and builds the .txt file from that same data. The refresh button
  clears that cache and goes back to the first batch. `subscriptions.list` stops paginating
  after **~1,000 items** per walk, whatever the account really has, so the download walks the list
  three times (`relevance`, `alphabetical`, `unread`) and merges the results. That reaches far more of a big subscription list, but beyond ~1,000
  subscriptions it is still not guaranteed to be complete.

### Compare both libraries

Once the complete artist list has been downloaded on **both** artists pages (that is what saves
them in `localStorage`), each page enables **Only on Spotify** and **Only on YouTube Music**.
They open `/compare`, which lists the artists followed on one service and missing on the other,
with a **Follow** button per artist.

- Names are the only thing both services share, so they are matched loosely
  (`src/lib/artist-compare.ts`): case, accents and punctuation are ignored, a leading "The" is
  dropped and trailing words such as "Official", "Music", "VEVO" or "Topic" are removed. A stage
  name spelled differently on each service still shows up as missing.
- **Follow on Spotify** searches the artist by name and saves the exact match to the library
  (`PUT /me/library`, which replaced `PUT /me/following` in February 2026). It needs the
  `user-follow-modify` and `user-library-modify` scopes: sessions created before they were added
  do not have them, so **sign out of Spotify and sign in again**.
- **Follow on YouTube Music** searches the channel (100 quota units) and subscribes (50), so about
  **150 units per artist**, roughly 65 a day. The "Name - Topic" channel is preferred.

### Artists you play but do not follow (Spotify only)

`/artists/unfollowed` lists the artists credited on your own songs that you are not following, the
ones you have most songs of first, with a Follow button on each row.

- The scan reads every song of every playlist you own or collaborate on
  (`GET /playlists/{id}/items`) plus your liked songs (`GET /me/tracks`), and compares them against
  the artists you follow. It is a long run of requests, so it is started by hand and the result is
  kept in `localStorage` until you scan again.
- If the complete artist list is already in `localStorage` (the ↓ button on the artists page left it
  there), the scan compares against that instead of walking `GET /me/following` again, and says how
  old that copy is. When it does have to fetch the list, it saves it, so the artists page and the
  next scan open with it.
- The progress bar counts **songs**, not lists: the playlist lengths come with the playlist list, so
  there is a total before anything is read, and each page corrects it with the real length.
- Artists are matched **by Spotify id**, never by name, so the list is exact and following goes
  straight to the right artist URI, with no search in between. This is why the feature is Spotify
  only: YouTube gives a video's artist no id of its own.
- Every credit counts, features included, and the count is what the list is sorted by. The same
  artist credited twice on one song still counts once.
- Reading the liked songs needs the `user-library-read` scope. Sessions created before it was added
  do not have it: the playlists are still scanned and the page says to **sign out of Spotify and
  sign in again**. A playlist Spotify refuses (403) is skipped rather than failing the scan, and a
  429 is waited out for the seconds Spotify asks for.
- If neither service has an artist under that exact name, the row shows an error instead of
  following the wrong one.
- The lists in `localStorage` are not updated by following: download them again to refresh the
  comparison.

### Copy Spotify playlists to YouTube Music

With both accounts connected, the Spotify **Playlists** page gets a **Copy to YouTube Music**
button for the selected playlists. The destination is a new playlist per Spotify playlist
(same name, your choice of privacy) or one existing YouTube Music playlist. Progress lives on
the **Copies** page (`/transfers`).

For each song the app searches YouTube for `artist + title` in the Music category, then scores
the results (`src/lib/youtube-match.ts`): title and artist match, `- Topic` / VEVO channels,
duration within a few seconds of Spotify's, and a penalty for live, cover, karaoke and similar
versions the track is not. Weak matches are added but flagged; nothing plausible means
"not found". On the Copies page you can confirm a doubtful match, remove it, or paste the
right YouTube / YouTube Music link.

**The quota is the real limit.** A song costs about 151 units (search 100 + durations 1 +
insert 50) out of 10,000 a day, so **about 65 songs a day**. The copy is built for that
(`src/lib/transfer-store.ts`):

- The queue and every finished song are saved in `localStorage` right away. When YouTube
  answers `quotaExceeded`, the copy pauses and the Copies page shows when the quota resets
  (midnight Pacific time). **Continue** picks up at the first pending song.
- The playlist id is saved as soon as it is created, so a resumed copy never creates it twice.
- The target playlist's current videos are read at the start of every run: songs already there
  are marked "already in the playlist" instead of being added again.
- Search results (including "not found", for 30 days) are cached per YouTube account, so a
  song is never paid for twice, even across different copies. **Retry unmatched** ignores
  the cache.
- The copy runs in the browser tab. Moving around the app is fine; closing or reloading the
  tab pauses it.

Limits: podcast episodes are skipped, "Liked videos" cannot be a destination, and only
Spotify playlists you own or collaborate on can be read. For more than ~65 songs a day, ask
Google for more quota (Google Cloud Console → YouTube Data API v3 → Quotas); it needs a review.

### Copy YouTube Music playlists to Spotify

The same flow works the other way: the YouTube Music **Playlists** page gets a **Copy to Spotify**
button, with the same destination choices (Spotify has no "unlisted": it is private or public)
and the same review on the **Copies** page, where you can paste an `open.spotify.com/track/...`
link for a song that was missed or matched wrong.

- Songs are read from YouTube with their durations (about 2 quota units per 50 songs) and
  searched on Spotify (`GET /search?type=track`, max 10 results): first as
  `track:"..." artist:"..."`, then as plain text. Results are scored with the same rules as the
  other direction.
- Spotify has **no daily quota**, only a short rate limit. When it answers 429 the copy waits the
  seconds Spotify asks for (up to a minute, a few times) and carries on; longer waits pause the
  job. Tracks are added **50 per request**.
- It needs the `playlist-modify-public` and `playlist-modify-private` scopes. Sessions created
  before they were added do not have them: **sign out of Spotify and sign in again**.
- Endpoints used (all in the February 2026 supported set): `POST /me/playlists`,
  `POST` / `DELETE /playlists/{id}/items`, `GET /playlists/{id}/items`, `GET /tracks/{id}`.


### 2. Environment variables

Copy `.env.example` to `.env.local` and fill it in:

```bash
AUTH_SPOTIFY_ID=your_client_id
AUTH_SPOTIFY_SECRET=your_client_secret
AUTH_GOOGLE_ID=your_google_client_id
AUTH_GOOGLE_SECRET=your_google_client_secret
AUTH_SECRET=  # generate it with: npx auth secret
```

### 3. Install and run

```bash
npm install
npm run dev
```

Open **<http://127.0.0.1:3000>**.

## How it works

```
src/
├── auth.ts                                # Auth.js instance #1: Spotify (scopes, token refresh)
├── auth-youtube.ts                        # Auth.js instance #2: Google / YouTube Music (own base path and cookies)
├── app/
│   ├── api/auth/[...nextauth]/route.ts    # Spotify login/callback/logout
│   ├── api/youtube-auth/[...nextauth]/route.ts  # Google login/callback/logout
│   ├── api/spotify/...                    # Spotify pagination routes (the token never leaves the server)
│   ├── api/youtube/...                    # YouTube Data API routes: artists, playlists, items, match, writes
│   ├── page.tsx                           # sign-in screen, or the sections of every connected service
│   ├── artists/, playlists/               # Spotify pages
│   ├── youtube-music/artists/, playlists/ # YouTube Music pages
│   ├── compare/                           # artists missing on the other service
│   └── transfers/                         # Spotify -> YouTube Music copies
├── components/                            # service-agnostic cards and lists, copy dialog, copies view
└── lib/
    ├── music.ts                           # provider-neutral types (ArtistSummary, PlaylistSummary, ExportedTrack)
    ├── services.ts                        # per-service config: fetchers, cache keys, labels
    ├── accounts.ts                        # reads both sessions
    ├── spotify.ts / spotify-client.ts     # Spotify Web API (server) / fetchers (browser)
    ├── youtube.ts / youtube-client.ts     # YouTube Data API (server) / fetchers (browser)
    ├── youtube-track-parser.ts            # video -> song / artists / album
    ├── youtube-match.ts                   # scores search results against a Spotify track
    ├── artist-compare.ts                  # matches artist names across services
    └── transfer-store.ts                  # resumable copy queue, both directions
```

### Authentication

**Two independent sessions.** With JWT sessions and no database, Auth.js keeps one account per
session, so a second provider on the same instance would replace the Spotify login. The app runs
two Auth.js instances instead: Spotify on `/api/auth` with the default `authjs.*` cookies, and
Google on `/api/youtube-auth` with `ytm.authjs.*` cookies. Both can be connected at once and each
has its own sign-out button in the header.


- **Authorization Code** flow handled by Auth.js. Spotify scopes: `user-follow-read`,
  `playlist-read-private`, `playlist-read-collaborative`, `playlist-modify-public`,
  `playlist-modify-private`, `user-follow-modify`, `user-library-read` and
  `user-library-modify`.
- The session is a **JWT in an httpOnly cookie**. The Spotify `access_token` lives there and is **never sent to the browser**: the client component asks `/api/spotify/following` for the data and the server adds the `Authorization` header.
- The Spotify access token lasts 1 hour. The `jwt` callback renews it on its own with the `refresh_token` (with a 60s margin). If the refresh fails, the session is marked with `error: "RefreshTokenError"` and the app sends you back to the login.

### Followed artists

`GET /v1/me/following?type=artist` uses **cursor pagination**, not offset: every response carries
`cursors.after`, which is the id of the last artist. The first page (50 artists) is rendered on the
server; the client component requests the following ones with that cursor.

## Troubleshooting: `redirect_uri: Not matching configuration`

If Spotify rejects the login with that message, look at the `redirect_uri` in the URL it
sent you to. If it says `localhost`, this is the problem:

- Spotify **requires** the literal IP (`http://127.0.0.1:3000/...`) and rejects `localhost`.
- The **Next 16 dev server normalizes `request.url` to `http://localhost:PORT`** even when the
  `Host` header says `127.0.0.1` (verified: `Host: 127.0.0.1:3000` →
  `request.url: http://localhost:3000/...`).
- Auth.js derives the `redirect_uri` from that URL (`parseProviders` uses `params.url.origin`),
  so it ends up sending `localhost` and Spotify rejects it.

Things that do **not** fix it, already tried:

| Attempt | Why it fails |
| --- | --- |
| Entering through `http://127.0.0.1:3000` | Next normalizes it anyway; the `redirect_uri` still says `localhost`. |
| `AUTH_URL=http://127.0.0.1:3000` | `reqWithEnvURL` rebuilds the `NextRequest` and Next normalizes the origin again. |
| `next dev -H 127.0.0.1` | Same result: `request.url` is still `localhost`. |
| `authorization.params.redirect_uri` | Fixes the authorize, but the code exchange uses `provider.callbackUrl` → `invalid_grant`. |
| Editing the OS `hosts` file | `hosts` resolves names to IPs; here the problem is the string Next emits, not the resolution. And a custom name does not help either: Spotify requires HTTPS except for literal loopback. |

**The solution** is in `src/app/api/auth/[...nextauth]/route.ts`: a wrapper that rewrites the
request origin to `AUTH_DEV_ORIGIN` before handing it to Auth.js, in development only. Since
both the authorize and the token exchange come from that same origin, they stay consistent.

If you change the dev server port, update `AUTH_DEV_ORIGIN` in `.env.local` **and** the
Redirect URI in the Spotify dashboard.

## Scripts

```bash
npm run dev     # dev server
npm run build   # production build
npm run start   # serve the build
npm run lint    # eslint
npm test        # title cleaner, YouTube track parser and match scoring tests
```

## Next steps

- Infinite scroll with `IntersectionObserver` instead of the "Load more" button.
- List and create playlists (scopes `playlist-read-private`, `playlist-modify-private`; the playlist endpoints are still supported).
- Cache the pages already fetched (`unstable_cache` or React Query) to avoid hitting Spotify again.

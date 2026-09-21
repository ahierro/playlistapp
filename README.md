# Playlist App

A Next.js application for browsing Spotify and YouTube library data, comparing artists and
playlists, exporting library data, and copying playlists between Spotify and YouTube. Spotify and
Google can be connected at the same time through independent OAuth sessions.

> [!IMPORTANT]
> The current implementation is suitable for local development, but it is **not ready for a
> YouTube API compliance audit or a public production release**. See
> [YouTube API compliance status](#youtube-api-compliance-status) for the known blockers.

## Technology stack

| Area | Technology |
| --- | --- |
| Application | **Next.js 16.3** with the App Router, React Server Components, Server Actions and route handlers |
| UI runtime | **React 19.2** and strict **TypeScript 5** |
| Authentication | **Auth.js v5 beta** with independent Spotify and Google OAuth 2.0 sessions and refresh-token handling |
| External APIs | **Spotify Web API** and the official **YouTube Data API v3** |
| Styling | **Tailwind CSS v4**, PostCSS, `class-variance-authority`, `clsx` and `tailwind-merge` |
| Components | Local **shadcn/ui-style** components backed by **Radix UI** |
| Icons and fonts | **Lucide React** and **Geist Sans / Geist Mono** |
| Client state | React hooks plus small `useSyncExternalStore` stores; no state-management framework |
| Persistence | Encrypted Auth.js JWT session cookies and browser `localStorage`; there is no database |
| Quality tooling | **ESLint 9**, `eslint-config-next`, and Node's built-in `node:test` runner |
| Package management | **npm** with a committed lockfile |

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
| **Client IDs** | Up to **25** per developer account since July 2026. |
| **Authorized users** | Up to **5**, added by hand under **Settings → User Management**. Any other account gets a `403`. |
| **Development quota** | Quota is shared by the developer account across all of its Development Mode Client IDs. A quota exhaustion response is a `429` with `reason: "QUOTA_EXCEEDED"`, distinct from a short-term rate limit. |
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

### 2. Create the Google OAuth client (YouTube Music)

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
| **Granular daily quota** | The current default is **100 `search.list` calls/day**, **100 `videos.insert` calls/day**, and **10,000 units/day shared by all other methods**. `search.list` and `videos.insert` use their own buckets and cost one call each. Most list requests cost 1 general unit; creating a playlist, adding a playlist item, or subscribing to a channel costs 50 general units. See Google's [current quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost). |
| **Reset and weekly usage** | Daily buckets reset at midnight Pacific Time. YouTube does not publish a standard weekly quota; the Cloud Console's seven-day peak is an observation window, not an additional weekly allowance. |
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
- **Follow on YouTube Music** makes one `search.list` call and one
  `subscriptions.insert` call. The first consumes one of the default 100 daily search calls; the
  second consumes 50 units from the general 10,000-unit bucket. The "Name - Topic" channel is
  preferred. The automatic selection and generic **Follow** action are compliance concerns; see
  the audit notes below.

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

**The quota is the real limit.** Under YouTube's granular quota model, a song that needs a search
typically consumes one of the 100 daily `search.list` calls plus about 51 general units
(`videos.list` 1 + `playlistItems.insert` 50). Consequently, the default practical ceiling is
usually **100 newly searched songs per day**, assuming enough of the 10,000-unit general bucket
remains. A cached match does not need another search. The copy queue is implemented in
`src/lib/transfer-store.ts`:

- The queue and every finished song are saved in `localStorage` right away. When YouTube
  answers `quotaExceeded`, the copy pauses and the Copies page shows when the quota resets
  (midnight Pacific time). **Continue** picks up at the first pending song.
- The playlist id is saved as soon as it is created, so a resumed copy never creates it twice.
- The target playlist's current videos are read at the start of every run: songs already there
  are marked "already in the playlist" instead of being added again.
- Search matches are cached per YouTube account, so the same song is normally not searched twice
  across copies. A "not found" entry expires after 30 days; successful matches currently do not
  expire. **Retry unmatched** ignores the negative cache. Indefinite successful-match retention is
  a compliance blocker documented below.
- The copy runs in the browser tab. Moving around the app is fine; closing or reloading the
  tab pauses it.

Limits: podcast episodes are skipped, "Liked videos" cannot be a destination, and only
Spotify playlists you own or collaborate on can be read. More than 100 new YouTube searches per
day requires a quota extension and a YouTube API compliance audit.

The estimate shown before a copy starts comes from `src/lib/youtube-quota.ts`, which models both
buckets separately: `estimateQuota()` returns the `search.list` calls and the general units a copy
needs, and `forecastQuota()` reports how many days it will span and **which bucket runs out
first**. For a copy to YouTube that is almost always the searches — 100 songs of searching spends
only ~5,100 of the 10,000 general units — so the dialog says "N searches and M units" rather than
one number. Copies in the other direction only read YouTube, so they spend no searches at all.

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

## YouTube API compliance status

This section is an engineering self-assessment performed on **2026-09-21** against the current
[YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies),
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
[OAuth 2.0 policies](https://developers.google.com/identity/protocols/oauth2/policies), and
[YouTube branding guidelines](https://developers.google.com/youtube/terms/branding-guidelines).
Only Google can make an official compliance determination. These requirements apply even if the
app is personal, remains in testing, or is exempt from OAuth verification.

### What already aligns

- All YouTube data is obtained through the documented YouTube Data API v3. The project does not
  scrape YouTube or use an undocumented YouTube Music endpoint.
- The application does not download, cache, or provide offline playback of YouTube audiovisual
  content.
- Playlist copies are initiated by the user, and new playlists expose a private, unlisted, or
  public visibility choice before creation.
- API credentials are read from environment variables, `.env*` is ignored by Git, and no Google
  or Spotify credential is intentionally committed.
- Mutating route handlers reject browser requests identified as cross-site.

### Blockers before a quota audit or public release

| Requirement | Current implementation | Required work |
| --- | --- | --- |
| Privacy policy and terms | There are no in-app privacy-policy or terms pages. The application does not require acceptance before API features are used. | Publish both pages on the production domain. The terms must link to and incorporate the [YouTube Terms of Service](https://www.youtube.com/t/terms). The privacy policy must identify the developer, explain every category of Google/YouTube data accessed, stored, used, deleted and shared, disclose cookies and `localStorage`, explain transfers to Spotify, link to the [Google Privacy Policy](https://policies.google.com/privacy) and [Google permissions page](https://security.google.com/settings/security/permissions), and provide a privacy contact. Require agreement before API access. |
| Accurate disclosure | The signed-out page currently says "We store nothing," but lists, scans, transfer jobs and search matches are stored in `localStorage`. | Replace the statement in `src/app/page.tsx` and describe client-side persistence accurately in the privacy policy and contextual notices. |
| Revocation and deletion | Signing out only ends the Auth.js session. It does not call Google's token-revocation endpoint or delete all data scoped to the YouTube account. | Add a clearly labelled disconnect/delete action that revokes the Google token immediately and removes the account's list caches, artist caches, match caches and transfer jobs. Also purge the data after external revocation or an unrecoverable refresh failure. Make clear that deleting local app data does not delete data held by YouTube. |
| 30-day retention | Generic caches accept entries of any age. Transfer jobs and successful YouTube matches have no expiry; only negative matches expire after 30 days. | Delete or refresh stored YouTube API data no later than 30 calendar days after retrieval, show the data age, and delete it sooner when authorization ends or the user requests deletion. |
| Derived data | `youtube-match.ts` scores and reranks search results, `youtube-track-parser.ts` infers song metadata, artist discovery classifies subscriptions from topics/uploads, and the comparison features derive cross-service matches and confidence labels. | Ask YouTube for an explicit determination or redesign these flows. The general policy prohibits creating new or derived data or metrics from API Data. The newer [derived-metrics exception](https://developers.google.com/youtube/terms/derived-metrics-policy) is for specifically approved audited analytics use cases and does not obviously cover playlist matching. The safest transfer flow is to show YouTube's unmodified, attributed results and let the user select the target. |
| Clear YouTube write actions | The artist comparison uses a generic **Follow** button, then searches for and automatically chooses the YouTube channel before subscribing. The exact target channel is only shown after the write. | Show the candidate channel before the write and use an explicit label such as **Subscribe to `<channel>` on YouTube**. Clearly identify the connected YouTube channel/account for all authorized writes. |
| Branding and attribution | YouTube pages use a YouTube Music icon sourced from Wikimedia. The header icon is not a link, and mixed Spotify/YouTube result views do not consistently use an official clickable YouTube attribution next to the relevant content. | Use an official, unmodified YouTube Brand Feature, link it to the associated YouTube content or section, and attribute YouTube-derived content at the point where it appears, especially in mixed-source comparisons and search results. |
| Minimum scopes | Google authorization requests `openid`, `email`, `profile`, and the full `youtube` scope at initial connection. The application uses name, image and account id but not the email address. | Remove `email` unless a documented feature needs it. Consider initial read-only access followed by contextual incremental authorization for write features; if the full scope remains, document why narrower scopes cannot support playlist creation, playlist-item writes and subscriptions. |
| Token exposure | API calls are made server-side, but both Auth.js session callbacks add provider access tokens to the public session object. A same-origin session response can therefore expose a token even though current client components do not use it. | Keep access and refresh tokens exclusively in server-only session state and return only the account fields needed by the browser. Review cookie flags and HTTPS deployment as part of the security assessment. |

Before requesting more quota, the production OAuth configuration must also use a verified HTTPS
domain, provide matching homepage/privacy/terms URLs, keep project contacts current, and include a
reviewable end-to-end demonstration of every requested scope. Quota cannot be purchased; increases
are granted through the
[YouTube API audit and quota-extension process](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits).


### 3. Environment variables

The repository does not contain an `.env.example`. Create `.env.local` in the project root and add:

```bash
AUTH_SPOTIFY_ID=your_client_id
AUTH_SPOTIFY_SECRET=your_client_secret
AUTH_GOOGLE_ID=your_google_client_id
AUTH_GOOGLE_SECRET=your_google_client_secret
AUTH_SECRET=  # generate it with: npx auth secret
# Optional; this is already the development default.
AUTH_DEV_ORIGIN=http://127.0.0.1:3000
```

Do not commit `.env.local` or any client secret. In development, leave `AUTH_URL` and
`NEXTAUTH_URL` unset so the request-origin wrapper can preserve the literal loopback address that
Spotify requires.

### 4. Install and run

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
│   ├── api/spotify/...                    # Spotify read/write proxy routes
│   ├── api/youtube/...                    # YouTube Data API routes: artists, playlists, items, match, writes
│   ├── page.tsx                           # sign-in screen, or the sections of every connected service
│   ├── artists/, artists/unfollowed/       # followed and library-derived Spotify artist pages
│   ├── playlists/                          # Spotify playlists
│   ├── youtube-music/artists/, playlists/ # YouTube Music pages
│   ├── compare/, compare/playlists/        # cross-service artist and playlist comparisons
│   └── transfers/                         # resumable copies in both directions
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
    ├── track-compare.ts                   # compares normalized tracks across services
    ├── unfollowed-artists.ts              # counts credited Spotify artists not followed
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
- Each service uses a **JWT in an httpOnly cookie**. Application API routes call Spotify and
  YouTube from the server and attach the corresponding bearer token. The current session callbacks
  also copy the access token into the session response; this unnecessary exposure is listed as a
  production blocker above.
- Provider access tokens are refreshed automatically with a 60-second margin. If refresh fails,
  the session is marked with `error: "RefreshTokenError"` and the app sends the user back to the
  login. Spotify refresh tokens now have a six-month lifetime, so periodic Spotify reauthentication
  is expected even when the app remains authorized.

### Followed artists

`GET /v1/me/following?type=artist` uses **cursor pagination**, not offset: every response carries
`cursors.after`, which is the id of the last artist. The client loads uniform batches of 20 through
the app's route handler as the user scrolls. The complete-list download walks Spotify pages of up
to 50 artists each and stores the result in the browser cache.

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
npm test        # parsers, matching, comparison, counting and quota unit tests
```

## Known implementation work

- Complete the YouTube policy work listed in the compliance section before requesting a quota
  extension or publishing the Google OAuth application.
- Add automated route-handler and browser-level tests. The existing suite covers pure parsing,
  normalization, comparison and counting logic only.

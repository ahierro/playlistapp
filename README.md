# Playlist App

A Next.js (App Router) + React app that lets you sign in with Spotify and lists every artist you follow.

## Stack

- **Next.js 16** (App Router, Server Components, route handlers)
- **React 19**
- **Auth.js v5** (`next-auth@beta`) with the Spotify provider and automatic token refresh
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

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill it in:

```bash
AUTH_SPOTIFY_ID=your_client_id
AUTH_SPOTIFY_SECRET=your_client_secret
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
├── auth.ts                                # Auth.js config: provider, scopes, token refresh
├── app/
│   ├── api/auth/[...nextauth]/route.ts    # login/callback/logout handlers
│   ├── api/spotify/following/route.ts     # pagination: the client asks here, the token never leaves the server
│   ├── page.tsx                           # landing + login button (redirects if a session already exists)
│   └── artists/page.tsx                   # first page of artists, rendered on the server
├── components/
│   ├── auth-buttons.tsx                   # signIn / signOut server actions
│   ├── followed-artists.tsx               # client component: "load more" + filter
│   └── artist-card.tsx
└── lib/spotify.ts                         # Web API client + types + errors
```

### Authentication

- **Authorization Code** flow handled by Auth.js. Only scope requested: `user-follow-read`.
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
```

## Next steps

- Infinite scroll with `IntersectionObserver` instead of the "Load more" button.
- List and create playlists (scopes `playlist-read-private`, `playlist-modify-private`; the playlist endpoints are still supported).
- Cache the pages already fetched (`unstable_cache` or React Query) to avoid hitting Spotify again.

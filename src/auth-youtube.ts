import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Second, independent Auth.js instance for YouTube Music (a Google account).
 *
 * Why a separate instance instead of a second provider on `@/auth`: with JWT
 * sessions and no database, Auth.js keeps ONE account per session, so signing in
 * with Google would replace the Spotify session. Two instances, each with its own
 * base path and cookie names, let both accounts stay connected at the same time
 * and be signed out of independently.
 *
 * YouTube Music has no public API of its own. Its playlists and subscriptions
 * live on the YouTube account, so we read them through the YouTube Data API v3.
 */
export const YOUTUBE_AUTH_BASE_PATH = "/api/youtube-auth";

/**
 * - openid / email / profile: name and picture for the header.
 * - youtube: read playlists, their items and channel subscriptions, AND create
 *   playlists / add videos to them. `youtube.readonly` cannot write, and the
 *   full scope already includes everything it grants, so only this one is asked.
 *
 * Google shows granular consent: the user can untick the YouTube permission. The
 * API then answers 403 and the UI asks them to sign in again.
 *
 * NOTE: sessions issued with a different scope keep it. After changing this list,
 * sign out of YouTube Music and back in.
 */
export const YOUTUBE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/youtube",
] as const;

const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Margin (in seconds) for refreshing the token before it actually expires. */
const EXPIRY_SKEW_SECONDS = 60;

/**
 * Cookie names that do not clash with the Spotify session (`authjs.*`). The JWT
 * encryption salt is the cookie name, so the two tokens are also isolated
 * cryptographically even though they share AUTH_SECRET.
 */
const COOKIE_PREFIX = "ytm.authjs";
const cookies = {
  sessionToken: { name: `${COOKIE_PREFIX}.session-token` },
  callbackUrl: { name: `${COOKIE_PREFIX}.callback-url` },
  csrfToken: { name: `${COOKIE_PREFIX}.csrf-token` },
  pkceCodeVerifier: { name: `${COOKIE_PREFIX}.pkce.code_verifier` },
  state: { name: `${COOKIE_PREFIX}.state` },
  nonce: { name: `${COOKIE_PREFIX}.nonce` },
  webauthnChallenge: { name: `${COOKIE_PREFIX}.challenge` },
};

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
};

/** Google only returns a new refresh_token occasionally: keep the old one otherwise. */
async function refreshGoogleAccessToken(refreshToken: string) {
  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET");
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Could not refresh the Google token (${response.status}): ${await response.text()}`,
    );
  }

  return (await response.json()) as GoogleTokenResponse;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  basePath: YOUTUBE_AUTH_BASE_PATH,
  cookies,
  providers: [
    Google({
      authorization: {
        params: {
          scope: YOUTUBE_SCOPES.join(" "),
          // Both are required to get a refresh_token back from Google.
          access_type: "offline",
          prompt: "consent",
          include_granted_scopes: "true",
        },
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, account }) {
      // 1. First sign-in: store the tokens Google returned.
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          // The Google account id (`sub`). Scopes the client-side cache.
          googleId: account.providerAccountId,
          expiresAt:
            account.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
          error: undefined,
        };
      }

      // 2. The token is still valid.
      if (
        typeof token.expiresAt === "number" &&
        Date.now() < (token.expiresAt - EXPIRY_SKEW_SECONDS) * 1000
      ) {
        return token;
      }

      // 3. Expired: try to renew it.
      if (typeof token.refreshToken !== "string") {
        return { ...token, error: "RefreshTokenError" as const };
      }

      try {
        const refreshed = await refreshGoogleAccessToken(token.refreshToken);

        return {
          ...token,
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token ?? token.refreshToken,
          expiresAt: Math.floor(Date.now() / 1000) + refreshed.expires_in,
          error: undefined,
        };
      } catch (error) {
        // Apps in Google's "Testing" publishing status get refresh tokens that
        // expire after 7 days, so this is expected once a week in development.
        console.error("[auth-youtube] Google token refresh failed", error);
        return { ...token, error: "RefreshTokenError" as const };
      }
    },

    async session({ session, token }) {
      session.accessToken =
        typeof token.accessToken === "string" ? token.accessToken : undefined;
      session.error = token.error;

      const id = token.googleId ?? token.sub;
      if (session.user && typeof id === "string") {
        session.user.id = id;
      }

      return session;
    },
  },
});

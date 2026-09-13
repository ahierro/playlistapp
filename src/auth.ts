import NextAuth from "next-auth";
import Spotify from "next-auth/providers/spotify";

/**
 * Permissions we request from Spotify.
 * - user-follow-read: artists the user follows
 * - playlist-read-private: their playlists, private ones included
 * - playlist-read-collaborative: plus the collaborative ones
 *
 * We do not request `user-read-email`: since the February 2026 changes the User
 * object no longer returns `email` (nor country, product, followers), so the scope
 * would add nothing and would add permissions to the consent screen.
 *
 * NOTE: if you add a scope, sessions that were already issued do NOT have it. You
 * have to sign out and sign back in so Spotify asks for the new permission.
 */
export const SPOTIFY_SCOPES = [
  "user-follow-read",
  "playlist-read-private",
  "playlist-read-collaborative",
] as const;

const AUTHORIZATION_URL =
  "https://accounts.spotify.com/authorize?" +
  new URLSearchParams({ scope: SPOTIFY_SCOPES.join(" ") }).toString();

const TOKEN_URL = "https://accounts.spotify.com/api/token";

/** Margin (in seconds) for refreshing the token before it actually expires. */
const EXPIRY_SKEW_SECONDS = 60;

type SpotifyTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
};

/**
 * Requests a new access token using the refresh token.
 * Spotify does not always return a new refresh_token: if it does not come, the old one is reused.
 */
async function refreshSpotifyAccessToken(refreshToken: string) {
  const clientId = process.env.AUTH_SPOTIFY_ID;
  const clientSecret = process.env.AUTH_SPOTIFY_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing AUTH_SPOTIFY_ID / AUTH_SPOTIFY_SECRET");
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Could not refresh the Spotify token (${response.status}): ${await response.text()}`,
    );
  }

  return (await response.json()) as SpotifyTokenResponse;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Spotify({
      authorization: AUTHORIZATION_URL,
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, account }) {
      // 1. First sign-in: store the tokens Spotify returned.
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
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
        const refreshed = await refreshSpotifyAccessToken(token.refreshToken);

        return {
          ...token,
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token ?? token.refreshToken,
          expiresAt: Math.floor(Date.now() / 1000) + refreshed.expires_in,
          error: undefined,
        };
      } catch (error) {
        console.error("[auth] Spotify token refresh failed", error);
        return { ...token, error: "RefreshTokenError" as const };
      }
    },

    async session({ session, token }) {
      session.accessToken =
        typeof token.accessToken === "string" ? token.accessToken : undefined;
      session.error = token.error;
      return session;
    },
  },
});

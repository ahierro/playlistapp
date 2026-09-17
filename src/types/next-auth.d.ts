import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    /**
     * Provider access token (Spotify or Google, depending on which Auth.js
     * instance issued the session), for calling the API from the server.
     */
    accessToken?: string;
    /** Present if the token could not be renewed and the user has to sign in again. */
    error?: "RefreshTokenError";
    user?: DefaultSession["user"] & {
      /** Provider user id. Scopes the client-side cache per account. */
      id?: string;
    };
  }
}

/**
 * `next-auth/jwt` only re-exports the type, so the augment has to point to the
 * module where `JWT` is actually declared.
 */
declare module "@auth/core/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    /** The Spotify user id, from `account.providerAccountId`. */
    spotifyId?: string;
    /** The Google account id, from `account.providerAccountId` (YouTube session). */
    googleId?: string;
    /** Epoch in seconds at which the access token expires. */
    expiresAt?: number;
    error?: "RefreshTokenError";
  }
}

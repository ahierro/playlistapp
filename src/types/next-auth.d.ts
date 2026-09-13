import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    /** Spotify access token, for calling the Web API from the server. */
    accessToken?: string;
    /** Present if the token could not be renewed and the user has to sign in again. */
    error?: "RefreshTokenError";
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
    /** Epoch in seconds at which the access token expires. */
    expiresAt?: number;
    error?: "RefreshTokenError";
  }
}

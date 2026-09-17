"use server";

import { signIn, signOut } from "@/auth";
import {
  signIn as signInYouTube,
  signOut as signOutYouTube,
} from "@/auth-youtube";

/**
 * Sign in / sign out as Server Actions in their own `"use server"` module.
 *
 * They used to be inline actions inside `auth-buttons.tsx`, which Next only allows
 * in Server Components. Now that `ScopeError` (and therefore `SignOutButton`) can
 * be rendered from a Client Component, the actions have to live in a separate
 * module the client is allowed to reference.
 */
export async function signInWithSpotify() {
  // Lands on the home page, which shows the Artists / Playlists picker rather
  // than jumping straight into one of them.
  await signIn("spotify", { redirectTo: "/" });
}

export async function signOutOfSpotify() {
  await signOut({ redirectTo: "/" });
}

/** Google account for YouTube Music. Independent from the Spotify session. */
export async function signInWithYouTubeMusic() {
  // Without these, Google answers "Error 401: invalid_client / The OAuth client
  // was not found", which does not say what is actually wrong.
  if (!process.env.AUTH_GOOGLE_ID?.trim() || !process.env.AUTH_GOOGLE_SECRET?.trim()) {
    throw new Error(
      "YouTube Music sign-in is not configured: set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET in .env.local (see README) and restart the dev server.",
    );
  }

  await signInYouTube("google", { redirectTo: "/" });
}

export async function signOutOfYouTubeMusic() {
  await signOutYouTube({ redirectTo: "/" });
}

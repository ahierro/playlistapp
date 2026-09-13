"use server";

import { signIn, signOut } from "@/auth";

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

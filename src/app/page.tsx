import { ListMusic, Users } from "lucide-react";

import { auth } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { SectionLink } from "@/components/section-link";
import { SignInButton } from "@/components/auth-buttons";

/**
 * Signed out: the sign-in screen.
 * Signed in: an empty home with two cards, so the user picks Artists or
 * Playlists instead of always landing on Artists first.
 */
export default async function HomePage() {
  const session = await auth();
  const signedIn = Boolean(session?.accessToken && !session.error);

  if (!signedIn) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="flex max-w-md flex-col items-center gap-6 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Users className="size-7" />
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">
              My followed artists
            </h1>
            <p className="text-muted-foreground">
              Sign in with your Spotify account and we will list every artist
              you follow. We store nothing: the tokens live in the session
              cookie.
            </p>
          </div>

          <SignInButton />

          {session?.error && (
            <p className="text-sm text-destructive" role="alert">
              Your Spotify session expired. Please sign in again.
            </p>
          )}
        </div>
      </main>
    );
  }

  return (
    <AppShell
      userName={session!.user?.name}
      userImage={session!.user?.image}
      title="What do you want to see?"
    >
      <div className="mx-auto grid max-w-2xl gap-4 sm:grid-cols-2">
        <SectionLink
          href="/artists"
          icon={Users}
          label="Artists"
          description="Every artist you follow, alphabetically."
        />
        <SectionLink
          href="/playlists"
          icon={ListMusic}
          label="Playlists"
          description="Your playlists, with a JSON export of their tracks."
        />
      </div>
    </AppShell>
  );
}

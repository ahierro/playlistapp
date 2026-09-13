import { redirect } from "next/navigation";
import { Users } from "lucide-react";

import { auth } from "@/auth";
import { SignInButton } from "@/components/auth-buttons";

export default async function HomePage() {
  const session = await auth();

  if (session?.accessToken && !session.error) {
    redirect("/artists");
  }

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
            Sign in with your Spotify account and we will list every artist you
            follow. We store nothing: the tokens live in the session cookie.
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

import { LogIn, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { signInWithSpotify, signOutOfSpotify } from "@/lib/auth-actions";

export function SignInButton({ className }: { className?: string }) {
  return (
    <form action={signInWithSpotify}>
      <Button type="submit" size="lg" className={className}>
        <LogIn />
        Sign in with Spotify
      </Button>
    </form>
  );
}

export function SignOutButton() {
  return (
    <form action={signOutOfSpotify}>
      <Button type="submit" variant="outline" size="sm">
        <LogOut />
        Sign out
      </Button>
    </form>
  );
}

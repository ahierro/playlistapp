import { LogIn, LogOut } from "lucide-react";

import { signIn, signOut } from "@/auth";
import { Button } from "@/components/ui/button";

export function SignInButton({ className }: { className?: string }) {
  return (
    <form
      action={async () => {
        "use server";
        await signIn("spotify", { redirectTo: "/artists" });
      }}
    >
      <Button type="submit" size="lg" className={className}>
        <LogIn />
        Sign in with Spotify
      </Button>
    </form>
  );
}

export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <Button type="submit" variant="outline" size="sm">
        <LogOut />
        Sign out
      </Button>
    </form>
  );
}

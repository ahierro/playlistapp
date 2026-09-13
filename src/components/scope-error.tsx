import { AlertTriangle } from "lucide-react";

import { SignOutButton } from "@/components/auth-buttons";

/**
 * Spotify returns 403 when the session does not have the required scope. It
 * happens when we add a new permission: already issued tokens do not include it.
 */
export function ScopeError({ detail }: { detail?: string }) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-xl border border-destructive/40 bg-destructive/10 p-6">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-5 text-destructive" />
        A Spotify permission is missing
      </div>

      <p className="text-sm text-muted-foreground">
        Your session was created before the app requested access to playlists.
        Sign out and sign back in to authorize the new permission.
        {detail && (
          <>
            <br />
            <span className="text-xs opacity-70">{detail}</span>
          </>
        )}
      </p>

      <SignOutButton />
    </div>
  );
}

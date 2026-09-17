import { AlertTriangle } from "lucide-react";

import { SignOutButton } from "@/components/auth-buttons";
import { SERVICE_LABELS, type MusicService } from "@/lib/music";

const EXPLANATIONS: Record<MusicService, string> = {
  spotify:
    "Your session was created before the app requested a permission it now needs (reading or creating playlists). Sign out of Spotify and sign back in to authorize it.",
  "youtube-music":
    "Google did not grant access to your YouTube account. Sign out and sign back in, and make sure the YouTube permission is ticked on the consent screen.",
};

/**
 * The API answered 403: the session does not have a permission the app needs.
 * With Spotify it happens when we add a scope; with Google, also when the user
 * unticks the YouTube permission on the granular consent screen.
 */
export function ScopeError({
  service,
  detail,
}: {
  service: MusicService;
  detail?: string;
}) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-xl border border-destructive/40 bg-destructive/10 p-6">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-5 text-destructive" />
        A {SERVICE_LABELS[service]} permission is missing
      </div>

      <p className="text-sm text-muted-foreground">
        {EXPLANATIONS[service]}
        {detail && (
          <>
            <br />
            <span className="text-xs opacity-70">{detail}</span>
          </>
        )}
      </p>

      <SignOutButton service={service} />
    </div>
  );
}

import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  signInWithSpotify,
  signInWithYouTubeMusic,
  signOutOfSpotify,
  signOutOfYouTubeMusic,
} from "@/lib/auth-actions";
import { SERVICE_LABELS, type MusicService } from "@/lib/music";
import { SERVICES } from "@/lib/services";

const SIGN_IN = {
  spotify: signInWithSpotify,
  "youtube-music": signInWithYouTubeMusic,
} satisfies Record<MusicService, () => Promise<void>>;

const SIGN_OUT = {
  spotify: signOutOfSpotify,
  "youtube-music": signOutOfYouTubeMusic,
} satisfies Record<MusicService, () => Promise<void>>;

export function SignInButton({
  service,
  className,
  size = "lg",
  variant = "default",
  label,
}: {
  service: MusicService;
  className?: string;
  size?: "lg" | "sm" | "default";
  variant?: "default" | "outline";
  label?: string;
}) {
  const Logo = SERVICES[service].icon;

  return (
    <form action={SIGN_IN[service]} className={SERVICES[service].themeClass}>
      <Button type="submit" size={size} variant={variant} className={className}>
        <Logo className={size === "lg" ? "size-5" : "size-4"} />
        {label ?? `Sign in with ${SERVICE_LABELS[service]}`}
      </Button>
    </form>
  );
}

/** Signs out of ONE service; the other session is left alone. */
export function SignOutButton({
  service,
  compact = false,
}: {
  service: MusicService;
  compact?: boolean;
}) {
  const label = `Sign out of ${SERVICE_LABELS[service]}`;

  return (
    <form action={SIGN_OUT[service]}>
      <Button
        type="submit"
        variant="outline"
        size={compact ? "icon" : "sm"}
        title={label}
      >
        <LogOut />
        {compact ? <span className="sr-only">{label}</span> : label}
      </Button>
    </form>
  );
}

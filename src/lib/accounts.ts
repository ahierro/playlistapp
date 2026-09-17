import type { Session } from "next-auth";

import { auth as authSpotify } from "@/auth";
import { auth as authYouTube } from "@/auth-youtube";
import type { MusicService } from "@/lib/music";

export type ConnectedAccount = {
  id: string;
  name: string | null;
  image: string | null;
};

export type Accounts = Record<MusicService, ConnectedAccount | null> & {
  /** Services whose session exists but could not be refreshed. */
  expired: MusicService[];
};

function toAccount(session: Session | null): ConnectedAccount | null {
  if (!session?.accessToken || session.error) return null;

  return {
    id: session.user?.id ?? "unknown-user",
    name: session.user?.name ?? null,
    image: session.user?.image ?? null,
  };
}

/** Both sessions at once. Each one is independent and may be missing. */
export async function getAccounts(): Promise<Accounts> {
  const [spotify, youtube] = await Promise.all([authSpotify(), authYouTube()]);

  const expired: MusicService[] = [];
  if (spotify?.error) expired.push("spotify");
  if (youtube?.error) expired.push("youtube-music");

  return {
    spotify: toAccount(spotify),
    "youtube-music": toAccount(youtube),
    expired,
  };
}

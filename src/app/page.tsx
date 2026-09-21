import {
  ArrowLeftRight,
  GitCompareArrows,
  ListMusic,
  Music,
  UserPlus,
  Users,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { SectionLink } from "@/components/section-link";
import { SignInButton } from "@/components/auth-buttons";
import { getAccounts } from "@/lib/accounts";
import { SERVICE_LABELS, type MusicService } from "@/lib/music";
import { SERVICES } from "@/lib/services";

const ORDER: MusicService[] = ["spotify", "youtube-music"];

const DESCRIPTIONS: Record<MusicService, { artists: string; playlists: string }> = {
  spotify: {
    artists: "Every artist you follow, alphabetically.",
    playlists: "Your playlists, with a JSON export of their tracks.",
  },
  "youtube-music": {
    artists: "Artist channels you are subscribed to.",
    playlists: "Your playlists and liked videos, with a JSON export.",
  },
};

/**
 * Signed out of everything: the sign-in screen, with one button per service.
 * Otherwise: one pair of cards per connected service, plus a prompt to connect
 * the other one. Both accounts can be connected at the same time.
 */
export default async function HomePage() {
  const accounts = await getAccounts();
  const connected = ORDER.filter((service) => accounts[service]);

  const expiredNotice =
    accounts.expired.length > 0 ? (
      <p className="text-sm text-destructive" role="alert">
        Your {accounts.expired.map((s) => SERVICE_LABELS[s]).join(" and ")}{" "}
        session expired. Please sign in again.
      </p>
    ) : null;

  if (connected.length === 0) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="flex max-w-md flex-col items-center gap-6 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Music className="size-7" />
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">
              Your music library
            </h1>
            <p className="text-muted-foreground">
              Sign in with Spotify, YouTube Music or both, and we will list
              your artists and playlists. We store nothing: the tokens live in
              the session cookies.
            </p>
          </div>

          <div className="flex w-full flex-col items-stretch gap-3">
            {ORDER.map((service) => (
              <SignInButton
                key={service}
                service={service}
                variant="outline"
                className="w-full"
              />
            ))}
          </div>

          {expiredNotice}
        </div>
      </main>
    );
  }

  const missing = ORDER.filter((service) => !accounts[service]);

  return (
    <AppShell accounts={accounts} title="What do you want to see?">
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        {expiredNotice}

        {connected.map((service) => {
          const { basePath, label, icon: Icon, themeClass } = SERVICES[service];

          return (
            <section
              key={service}
              className={`flex flex-col gap-3 ${themeClass}`}
            >
              <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                <Icon className="size-4" />
                {label}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <SectionLink
                  href={`${basePath}/artists`}
                  icon={Users}
                  label="Artists"
                  description={DESCRIPTIONS[service].artists}
                />
                <SectionLink
                  href={`${basePath}/playlists`}
                  icon={ListMusic}
                  label="Playlists"
                  description={DESCRIPTIONS[service].playlists}
                />
                {/* Only Spotify gives a track's artists an id of their own. */}
                {service === "spotify" && (
                  <SectionLink
                    href="/artists/unfollowed"
                    icon={UserPlus}
                    label="Artists you don't follow"
                    description="Who is in your playlists and liked songs, ready to follow."
                  />
                )}
              </div>
            </section>
          );
        })}

        {connected.length === 2 && (
          <section className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              <ArrowLeftRight className="size-4" />
              Copies
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <SectionLink
                href="/transfers"
                icon={ArrowLeftRight}
                label="Spotify ⇄ YouTube Music"
                description="Copy playlists either way, then review the matches."
              />
              <SectionLink
                href="/compare/playlists"
                icon={GitCompareArrows}
                label="Compare two playlists"
                description="What they share, what each one is missing, and copy it over."
              />
            </div>
          </section>
        )}

        {missing.map((service) => (
          <section
            key={service}
            className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-5 ${SERVICES[service].themeClass}`}
          >
            <p className="text-sm text-muted-foreground">
              Also use {SERVICE_LABELS[service]}? Both accounts can stay
              connected.
            </p>
            <SignInButton
              service={service}
              size="sm"
              variant="outline"
              label={`Connect ${SERVICE_LABELS[service]}`}
            />
          </section>
        ))}
      </div>
    </AppShell>
  );
}

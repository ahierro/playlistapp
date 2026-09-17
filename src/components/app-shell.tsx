import type { ReactNode } from "react";
import Image from "next/image";

import { SignInButton, SignOutButton } from "@/components/auth-buttons";
import { MainNav } from "@/components/main-nav";
import type { Accounts } from "@/lib/accounts";
import type { MusicService } from "@/lib/music";
import { SERVICES } from "@/lib/services";
import { cn } from "@/lib/utils";

type Props = {
  accounts: Accounts;
  /** Brand color for the page content (YouTube pages are red). */
  theme?: "spotify" | "youtube";
  title: string;
  children: ReactNode;
};

const ORDER: MusicService[] = ["spotify", "youtube-music"];

/**
 * Header + navigation shared by the authenticated sections.
 *
 * Shows one chip per service: the connected account with its own sign-out, or a
 * button to connect the missing one. The two sessions are independent.
 *
 * It is a component and not a `layout.tsx` on purpose: moving the pages into a
 * route group would mean deleting the old files, and the bridge to your
 * machine can write but not delete. This way the change is purely additive.
 */
export function AppShell({ accounts, theme = "spotify", title, children }: Props) {
  const connected = ORDER.filter((service) => accounts[service]);

  return (
    <>
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <ul className="flex min-w-0 flex-wrap items-center gap-2">
            {ORDER.map((service) => {
              const account = accounts[service];
              const { icon: Icon, label } = SERVICES[service];

              if (!account) {
                return (
                  <li key={service}>
                    <SignInButton
                      service={service}
                      size="sm"
                      variant="outline"
                      label={`Connect ${label}`}
                    />
                  </li>
                );
              }

              return (
                <li
                  key={service}
                  className={cn(SERVICES[service].themeClass, "flex min-w-0 items-center gap-2 rounded-full border bg-card py-1 pr-1 pl-1")}
                >
                  {account.image ? (
                    <Image
                      src={account.image}
                      alt=""
                      width={28}
                      height={28}
                      className="size-7 rounded-full object-cover"
                    />
                  ) : (
                    <Icon className="size-7" />
                  )}
                  <div className="min-w-0 leading-tight">
                    <p className="max-w-40 truncate text-sm font-semibold">
                      {account.name ?? "Your account"}
                    </p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Icon className="size-3" />
                      {label}
                    </p>
                  </div>
                  <SignOutButton service={service} compact />
                </li>
              );
            })}
          </ul>

          <MainNav services={connected} showTransfers={connected.length === 2} />
        </div>
      </header>

      <main
        className={cn(
          "mx-auto w-full max-w-6xl flex-1 px-6 py-8",
          theme === "youtube" && "theme-youtube",
        )}
      >
        <h1 className="mb-6 text-2xl font-bold tracking-tight">{title}</h1>
        {children}
      </main>
    </>
  );
}

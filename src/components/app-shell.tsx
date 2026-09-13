import type { ReactNode } from "react";
import Image from "next/image";

import { SignOutButton } from "@/components/auth-buttons";
import { MainNav } from "@/components/main-nav";

type Props = {
  userName?: string | null;
  userImage?: string | null;
  title: string;
  children: ReactNode;
};

/**
 * Header + navigation shared by the authenticated sections.
 *
 * It is a component and not a `layout.tsx` on purpose: moving the pages into a
 * route group would mean deleting the old files, and the bridge to your
 * machine can write but not delete. This way the change is purely additive.
 */
export function AppShell({ userName, userImage, title, children }: Props) {
  return (
    <>
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {userImage && (
              <Image
                src={userImage}
                alt=""
                width={36}
                height={36}
                className="size-9 rounded-full object-cover"
              />
            )}
            {/* Since February 2026 the User object no longer carries `email`. */}
            <p className="truncate font-semibold">{userName ?? "Your account"}</p>
          </div>

          <div className="flex items-center gap-2">
            <MainNav />
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <h1 className="mb-6 text-2xl font-bold tracking-tight">{title}</h1>
        {children}
      </main>
    </>
  );
}

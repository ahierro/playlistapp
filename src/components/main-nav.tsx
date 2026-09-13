"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ListMusic, Users } from "lucide-react";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/artists", label: "Artists", icon: Users },
  { href: "/playlists", label: "Playlists", icon: ListMusic },
] as const;

export function MainNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Sections">
      <ul className="flex items-center gap-1 rounded-full bg-secondary p-1">
        {LINKS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);

          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

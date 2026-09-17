"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ListMusic, Users } from "lucide-react";

import type { MusicService } from "@/lib/music";
import { SERVICES } from "@/lib/services";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { path: "/artists", label: "Artists", icon: Users },
  { path: "/playlists", label: "Playlists", icon: ListMusic },
] as const;

/** One pill per connected service, each with its Artists / Playlists links. */
export function MainNav({ services }: { services: MusicService[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Sections" className="flex flex-wrap items-center gap-2">
      {services.map((service) => {
        const { basePath, label, icon: ServiceIcon } = SERVICES[service];

        return (
          <ul
            key={service}
            aria-label={label}
            className="flex items-center gap-1 rounded-full bg-secondary p-1"
          >
            <li
              className="flex items-center pr-1 pl-2 text-muted-foreground"
              title={label}
            >
              <ServiceIcon className="size-4" />
              <span className="sr-only">{label}</span>
            </li>
            {SECTIONS.map(({ path, label: sectionLabel, icon: Icon }) => {
              const href = `${basePath}${path}`;
              const active =
                pathname === href || pathname.startsWith(`${href}/`);

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
                    {sectionLabel}
                  </Link>
                </li>
              );
            })}
          </ul>
        );
      })}
    </nav>
  );
}

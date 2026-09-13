import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";

/** One of the two choices on the empty home page. */
export function SectionLink({
  href,
  icon: Icon,
  label,
  description,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-xl border bg-card p-5 transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Icon className="size-5" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="font-semibold">{label}</p>
        <p className="truncate text-sm text-muted-foreground">
          {description}
        </p>
      </div>

      <ChevronRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

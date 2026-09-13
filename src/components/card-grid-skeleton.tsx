import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Placeholder grid for the first load, when there is nothing in the cache yet.
 * Mirrors the card grid so the layout does not jump when the data arrives.
 */
export function CardGridSkeleton({
  count = 10,
  shape = "square",
}: {
  count?: number;
  /** Artists are round, playlists are square. */
  shape?: "square" | "circle";
}) {
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: count }).map((_, index) => (
        <li key={index} className="flex flex-col gap-3 rounded-xl border p-4">
          <Skeleton
            className={cn(
              "aspect-square w-full",
              shape === "circle" ? "rounded-full" : "rounded-md",
            )}
          />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </li>
      ))}
    </ul>
  );
}

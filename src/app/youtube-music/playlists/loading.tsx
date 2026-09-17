import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingPlaylists() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <Skeleton className="mb-6 h-8 w-48" />
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, index) => (
          <li key={index} className="flex flex-col gap-3 rounded-xl border p-4">
            <Skeleton className="aspect-square w-full rounded-md" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </li>
        ))}
      </ul>
    </main>
  );
}

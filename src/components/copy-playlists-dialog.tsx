"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SERVICE_LABELS, type PlaylistSummary } from "@/lib/music";
import { SERVICES } from "@/lib/services";
import {
  ADAPTERS,
  enqueueTransfers,
  initTransfers,
  type Direction,
} from "@/lib/transfer-store";
import {
  DAILY_GENERAL_UNITS,
  DAILY_SEARCH_CALLS,
  estimateQuota,
  forecastQuota,
} from "@/lib/youtube-quota";
import { useCachedList } from "@/lib/use-cached-list";
import { cn } from "@/lib/utils";
import type { PrivacyStatus } from "@/lib/youtube-client";

/** YouTube's "Liked videos" cannot be written to through the API. */
const YOUTUBE_LIKES_ID = "LL";

const PRIVACY_OPTIONS: Record<Direction, { value: PrivacyStatus; label: string }[]> = {
  "spotify-to-youtube": [
    { value: "private", label: "Private" },
    { value: "unlisted", label: "Unlisted" },
    { value: "public", label: "Public" },
  ],
  // Spotify has no "unlisted".
  "youtube-to-spotify": [
    { value: "private", label: "Private" },
    { value: "public", label: "Public" },
  ],
};

type Props = {
  direction: Direction;
  playlists: PlaylistSummary[];
  spotifyUserId: string;
  youtubeUserId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Copies the selected playlists to the other service, in either direction. */
export function CopyPlaylistsDialog(props: Props) {
  const target = ADAPTERS[props.direction].target;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className={cn(SERVICES[target].themeClass, "max-w-lg")}>
        {/* Mounted only while open, so the target playlists load on demand. */}
        {props.open && <CopyForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function CopyForm({
  direction,
  playlists,
  spotifyUserId,
  youtubeUserId,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const target = ADAPTERS[direction].target;
  const targetLabel = SERVICE_LABELS[target];
  const targetUserId = target === "spotify" ? spotifyUserId : youtubeUserId;
  const themeClass = SERVICES[target].themeClass;

  const single = playlists.length === 1;
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [title, setTitle] = useState(single ? playlists[0].name : "");
  const [privacy, setPrivacy] = useState<PrivacyStatus>("private");
  const [targetId, setTargetId] = useState("");

  const config = SERVICES[target].playlists;
  const { items, isLoading, error, refresh } = useCachedList<PlaylistSummary>({
    cacheKey: config.cacheKey,
    scope: targetUserId,
    fetchAll: config.fetchAll,
    sort: config.sort,
  });

  const targets = useMemo(
    () =>
      (items ?? []).filter((playlist) =>
        target === "youtube-music"
          ? playlist.id !== YOUTUBE_LIKES_ID && playlist.isMusic !== false
          : // Only playlists the user can write to.
            playlist.ownerId === spotifyUserId || playlist.collaborative,
      ),
    [items, target, spotifyUserId],
  );

  const trackCount = playlists.reduce(
    (sum, playlist) => sum + (playlist.trackCount ?? 0),
    0,
  );
  const quota = estimateQuota(
    direction,
    trackCount,
    mode === "new" ? playlists.length : 0,
  );
  const { days, limitedBy } = forecastQuota(quota);

  const chosen = targets.find((playlist) => playlist.id === targetId);
  const canSubmit =
    mode === "new" ? !single || title.trim().length > 0 : Boolean(chosen);

  function submit() {
    if (!canSubmit) return;

    initTransfers(spotifyUserId, youtubeUserId);
    enqueueTransfers(
      direction,
      playlists,
      mode === "new"
        ? { mode: "new", privacyStatus: privacy, title: single ? title : undefined }
        : { mode: "existing", playlistId: chosen!.id, title: chosen!.name },
    );
    onOpenChange(false);
    router.push("/transfers");
  }

  return (
    <>
      <div className="space-y-1.5 pr-6">
        <DialogTitle className="flex items-center gap-2">
          <Copy className="size-4" />
          Copy to {targetLabel}
        </DialogTitle>
        <DialogDescription>
          {single ? `“${playlists[0].name}”` : `${playlists.length} playlists`}
          {trackCount > 0 && ` · ${trackCount.toLocaleString("en-US")} tracks`}.
          Each song is searched on {targetLabel} and added automatically;
          doubtful matches are listed for review at the end.
        </DialogDescription>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">Destination</legend>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="mode"
            checked={mode === "new"}
            onChange={() => setMode("new")}
            className="accent-primary"
          />
          {single ? "A new playlist" : "A new playlist for each one (same names)"}
        </label>

        {mode === "new" && (
          <div className="flex flex-col gap-2 pl-6">
            {single && (
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={target === "spotify" ? 100 : 150}
                aria-label="New playlist name"
                placeholder="Playlist name"
              />
            )}
            <Select
              value={privacy}
              onValueChange={(value) => setPrivacy(value as PrivacyStatus)}
            >
              <SelectTrigger aria-label="Privacy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={themeClass}>
                {PRIVACY_OPTIONS[direction].map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="mode"
            checked={mode === "existing"}
            onChange={() => setMode("existing")}
            className="accent-primary"
          />
          {single
            ? `Add to one of my ${targetLabel} playlists`
            : `Add all of them to one of my ${targetLabel} playlists`}
        </label>

        {mode === "existing" && (
          <div className="flex flex-col gap-1.5 pl-6">
            <Select
              value={targetId}
              onValueChange={setTargetId}
              disabled={isLoading || targets.length === 0}
            >
              <SelectTrigger aria-label="Target playlist">
                <SelectValue
                  placeholder={
                    isLoading
                      ? "Loading your playlists…"
                      : targets.length === 0
                        ? "You have no playlists yet"
                        : "Choose a playlist"
                  }
                />
              </SelectTrigger>
              <SelectContent className={themeClass}>
                {targets.map((playlist) => (
                  <SelectItem key={playlist.id} value={playlist.id}>
                    {playlist.name}
                    {playlist.trackCount !== null
                      ? ` (${playlist.trackCount})`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {error && (
              <p className="text-xs text-destructive">
                {error}{" "}
                <button type="button" className="underline" onClick={refresh}>
                  Retry
                </button>
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Songs already in that playlist are skipped, never duplicated.
            </p>
          </div>
        )}
      </fieldset>

      <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        {direction === "spotify-to-youtube" ? (
          <>
            YouTube allows {DAILY_SEARCH_CALLS} searches a day and{" "}
            {DAILY_GENERAL_UNITS.toLocaleString("en-US")} units for everything
            else. This copy needs up to{" "}
            <strong className="text-foreground">
              {quota.search.toLocaleString("en-US")} searches
            </strong>{" "}
            and{" "}
            <strong className="text-foreground">
              {quota.general.toLocaleString("en-US")} units
            </strong>{" "}
            (one search and 51 units per song).{" "}
            {days > 1
              ? `Expect it to take about ${days} days — the ${
                  limitedBy === "search" ? "searches" : "units"
                } run out first — and it pauses when they do, so you continue it the next day from the Copies page.`
              : "It should fit in today's quota, unless you already used part of it."}
          </>
        ) : (
          <>
            Spotify has no daily limit: the whole copy runs now. Reading the
            YouTube playlists uses about{" "}
            <strong className="text-foreground">{quota.general}</strong> YouTube
            units and no searches at all. If Spotify asks to slow down, the copy
            waits a few seconds and carries on. If Spotify rejects the copy for
            a missing permission, sign out of Spotify and sign in again.
          </>
        )}{" "}
        Keep the tab open while it runs.
      </p>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!canSubmit}>
          Start copy
          <ArrowRight />
        </Button>
      </div>
    </>
  );
}

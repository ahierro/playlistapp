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
import type { PlaylistSummary } from "@/lib/music";
import { SERVICES } from "@/lib/services";
import {
  enqueueTransfers,
  estimateUnits,
  initTransfers,
} from "@/lib/transfer-store";
import { useCachedList } from "@/lib/use-cached-list";
import type { PrivacyStatus } from "@/lib/youtube-client";

const DAILY_UNITS = 10_000;
/** The system "Liked videos" playlist cannot be written to through the API. */
const LIKES_ID = "LL";

type Props = {
  playlists: PlaylistSummary[];
  spotifyUserId: string;
  youtubeUserId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CopyToYouTubeDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg">
        {/* Mounted only while open, so the YouTube playlists load on demand. */}
        {props.open && <CopyForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function CopyForm({
  playlists,
  spotifyUserId,
  youtubeUserId,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const single = playlists.length === 1;
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [title, setTitle] = useState(single ? playlists[0].name : "");
  const [privacy, setPrivacy] = useState<PrivacyStatus>("private");
  const [targetId, setTargetId] = useState("");

  const ytConfig = SERVICES["youtube-music"].playlists;
  const { items, isLoading, error, refresh } = useCachedList<PlaylistSummary>({
    cacheKey: ytConfig.cacheKey,
    scope: youtubeUserId,
    fetchAll: ytConfig.fetchAll,
    sort: ytConfig.sort,
  });

  const targets = useMemo(
    () =>
      (items ?? []).filter(
        (playlist) => playlist.id !== LIKES_ID && playlist.isMusic !== false,
      ),
    [items],
  );

  const trackCount = playlists.reduce(
    (sum, playlist) => sum + (playlist.trackCount ?? 0),
    0,
  );
  const units = estimateUnits(trackCount, false) + (mode === "new" ? 50 * playlists.length : 0);
  const days = Math.max(1, Math.ceil(units / DAILY_UNITS));

  const target = targets.find((playlist) => playlist.id === targetId);
  const canSubmit =
    mode === "new" ? !single || title.trim().length > 0 : Boolean(target);

  function submit() {
    if (!canSubmit) return;

    initTransfers(spotifyUserId, youtubeUserId);
    enqueueTransfers(
      playlists,
      mode === "new"
        ? { mode: "new", privacyStatus: privacy, title: single ? title : undefined }
        : { mode: "existing", playlistId: target!.id, title: target!.name },
    );
    onOpenChange(false);
    router.push("/transfers");
  }

  return (
    <>
      <div className="space-y-1.5 pr-6">
        <DialogTitle className="flex items-center gap-2">
          <Copy className="size-4" />
          Copy to YouTube Music
        </DialogTitle>
        <DialogDescription>
          {single
            ? `“${playlists[0].name}”`
            : `${playlists.length} playlists`}{" "}
          · {trackCount.toLocaleString("en-US")} tracks. Each song is searched
          on YouTube and added automatically; doubtful matches are listed for
          review at the end.
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
                maxLength={150}
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
              <SelectContent>
                <SelectItem value="private">Private</SelectItem>
                <SelectItem value="unlisted">Unlisted</SelectItem>
                <SelectItem value="public">Public</SelectItem>
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
            ? "Add to one of my YouTube Music playlists"
            : "Add all of them to one of my YouTube Music playlists"}
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
              <SelectContent>
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
        YouTube allows about {DAILY_UNITS.toLocaleString("en-US")} quota units
        a day and this copy needs up to{" "}
        <strong className="text-foreground">
          {units.toLocaleString("en-US")}
        </strong>{" "}
        (about 150 per song).{" "}
        {days > 1
          ? `Expect it to take about ${days} days: it pauses when the quota runs out and you continue it the next day from the Transfers page.`
          : "It should fit in today's quota, unless you already used part of it."}{" "}
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

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { isArtistChannel, topicName, youtubeFetch } from "@/lib/youtube";
import { withYouTubeSession } from "@/lib/youtube-route";

/**
 * DEVELOPMENT ONLY. Walks the subscriptions in every order YouTube supports and
 * reports how far each walk gets, so a short artist list can be traced to either
 * the API stopping early or the artist filter. Writes the report to
 * `logs/youtube-debug.json` as well. Costs roughly 1 quota unit per page.
 */
type Sub = { snippet?: { title?: string; resourceId?: { channelId?: string } } };
type Page = {
  items?: Sub[];
  nextPageToken?: string;
  pageInfo?: { totalResults?: number };
};

const ORDERS = [undefined, "alphabetical", "unread"] as const;
const MAX_PAGES = 60;

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return withYouTubeSession("api/youtube/debug", async (accessToken) => {
    const walks = [];
    const union = new Map<string, string>();

    for (const order of ORDERS) {
      const pages: { size: number; nextTokenSample: string | null }[] = [];
      const titles: string[] = [];
      let total: number | null = null;
      let token: string | undefined;
      let stoppedBecause = "max pages";

      for (let i = 0; i < MAX_PAGES; i++) {
        const data = await youtubeFetch<Page>(
          "/subscriptions",
          { part: "snippet", mine: "true", maxResults: "50", order, pageToken: token },
          accessToken,
        );
        total = data.pageInfo?.totalResults ?? total;
        for (const item of data.items ?? []) {
          const id = item.snippet?.resourceId?.channelId;
          const title = item.snippet?.title ?? "";
          titles.push(title);
          if (id) union.set(id, title);
        }
        pages.push({
          size: data.items?.length ?? 0,
          nextTokenSample: data.nextPageToken ?? null,
        });
        if (!data.nextPageToken) {
          stoppedBecause = "no nextPageToken";
          break;
        }
        if (data.nextPageToken === token) {
          stoppedBecause = "token repeated";
          break;
        }
        token = data.nextPageToken;
      }

      walks.push({
        order: order ?? "default (relevance)",
        totalResultsReported: total,
        scanned: titles.length,
        pages: pages.length,
        stoppedBecause,
        firstTitles: titles.slice(0, 3),
        lastTitles: titles.slice(-3),
        lastPages: pages.slice(-2),
      });
    }

    // Artist filter over the union of every walk.
    const ids = [...union.keys()];
    let artists = 0;
    const rejectedSample: string[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const data = await youtubeFetch<{
        items?: { id: string; topicDetails?: { topicCategories?: string[] } }[];
      }>(
        "/channels",
        { part: "topicDetails", id: batch.join(","), maxResults: "50" },
        accessToken,
      );
      const topics = new Map(
        (data.items ?? []).map((c) => [
          c.id,
          (c.topicDetails?.topicCategories ?? []).map(topicName),
        ]),
      );
      for (const id of batch) {
        const title = union.get(id) ?? "";
        if (isArtistChannel(title, topics.get(id) ?? [])) artists++;
        else if (rejectedSample.length < 40) rejectedSample.push(title);
      }
    }

    const report = {
      at: new Date().toISOString(),
      walks,
      uniqueSubscriptionsAcrossWalks: union.size,
      artistsAcrossWalks: artists,
      rejectedByFilterSample: rejectedSample,
    };

    try {
      const dir = path.join(process.cwd(), "logs");
      await mkdir(dir, { recursive: true });
      await appendFile(
        path.join(dir, "youtube-debug.json"),
        JSON.stringify(report, null, 2) + "\n",
      );
    } catch (error) {
      console.error("[youtube/debug] could not write the report", error);
    }

    return NextResponse.json(report);
  });
}

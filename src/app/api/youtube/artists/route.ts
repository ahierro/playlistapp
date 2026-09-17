import { NextResponse } from "next/server";

import {
  getYouTubeArtists,
  SUBSCRIPTION_ORDERS,
  type SubscriptionOrder,
} from "@/lib/youtube";
import { readPageToken, withYouTubeSession } from "@/lib/youtube-route";

/** One page of subscribed artist channels, in the requested `order`. */
export async function GET(request: Request) {
  const orderParam = new URL(request.url).searchParams.get("order") ?? "relevance";

  if (!(SUBSCRIPTION_ORDERS as readonly string[]).includes(orderParam)) {
    return NextResponse.json({ error: "Invalid order" }, { status: 400 });
  }

  return withYouTubeSession("api/youtube/artists", async (accessToken) => {
    const page = await getYouTubeArtists(accessToken, {
      pageToken: readPageToken(request),
      order: orderParam as SubscriptionOrder,
    });
    return NextResponse.json(page);
  });
}

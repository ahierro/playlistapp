import assert from "node:assert/strict";
import test from "node:test";

import {
  DAILY_GENERAL_UNITS,
  DAILY_SEARCH_CALLS,
  estimateQuota,
  forecastQuota,
  tracksPerDay,
} from "./youtube-quota.ts";

test("a copy to YouTube spends one search call and 51 units per song", () => {
  assert.deepEqual(estimateQuota("spotify-to-youtube", 10, 0), {
    search: 10,
    general: 510,
  });
});

test("a new playlist adds its own write", () => {
  const withoutPlaylist = estimateQuota("spotify-to-youtube", 10, 0);
  const withPlaylist = estimateQuota("spotify-to-youtube", 10, 1);
  assert.equal(withPlaylist.general - withoutPlaylist.general, 50);
  assert.equal(withPlaylist.search, withoutPlaylist.search);
});

test("a copy to Spotify searches nothing on YouTube", () => {
  const estimate = estimateQuota("youtube-to-spotify", 120, 1);
  assert.equal(estimate.search, 0);
  // Three pages of 50 at 2 units each, plus reading the target playlist.
  assert.equal(estimate.general, 7);
});

test("the search bucket is what limits a copy to YouTube", () => {
  // A day's searches cost half the general bucket, so search runs out first.
  const estimate = estimateQuota("spotify-to-youtube", DAILY_SEARCH_CALLS, 0);
  assert.ok(estimate.general < DAILY_GENERAL_UNITS);
  assert.deepEqual(forecastQuota(estimate), { days: 1, limitedBy: "search" });
});

test("a long copy is measured in days of searches", () => {
  const estimate = estimateQuota("spotify-to-youtube", 450, 0);
  assert.deepEqual(forecastQuota(estimate), { days: 5, limitedBy: "search" });
});

test("reading alone is limited by the general bucket", () => {
  const estimate = estimateQuota("youtube-to-spotify", 200, 0);
  assert.equal(forecastQuota(estimate).limitedBy, "general");
});

test("a copy of nothing still takes a day and blames no bucket", () => {
  assert.deepEqual(forecastQuota({ search: 0, general: 0 }), {
    days: 1,
    limitedBy: null,
  });
});

test("a day covers about 100 songs to YouTube", () => {
  assert.equal(tracksPerDay("spotify-to-youtube"), 100);
});

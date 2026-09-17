import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSearchQuery,
  coreTitle,
  parseIsoDuration,
  parseVideoId,
  pickBestMatch,
} from "./youtube-match.ts";

const query = {
  name: "De Música Ligera - Remastered 2007",
  artists: ["Soda Stereo"],
  durationMs: 211_000,
};

const topic = {
  videoId: "aaaaaaaaaaa",
  title: "De Música Ligera (Remasterizado 2007)",
  channelTitle: "Soda Stereo - Topic",
  durationSeconds: 212,
};
const live = {
  videoId: "bbbbbbbbbbb",
  title: "Soda Stereo - De Música Ligera (En Vivo)",
  channelTitle: "Soda Stereo",
  durationSeconds: 380,
};
const cover = {
  videoId: "ccccccccccc",
  title: "De musica ligera cover guitarra",
  channelTitle: "Someone Plays",
  durationSeconds: 200,
};
const unrelated = {
  videoId: "ddddddddddd",
  title: "Top 10 rock nacional",
  channelTitle: "Rankings",
  durationSeconds: 900,
};

test("prefers the Topic upload with the right duration", () => {
  const best = pickBestMatch(query, [live, cover, topic]);
  assert.equal(best?.videoId, topic.videoId);
  assert.equal(best?.confidence, "high");
});

test("does not pick a live version over nothing when the track is a studio one", () => {
  assert.equal(pickBestMatch(query, [live, unrelated])?.videoId ?? null, null);
});

test("accepts a live version when the track itself is live", () => {
  const liveQuery = { name: "De Música Ligera (En Vivo)", artists: ["Soda Stereo"], durationMs: 380_000 };
  assert.equal(pickBestMatch(liveQuery, [live])?.videoId, live.videoId);
});

test("returns null when nothing matches", () => {
  assert.equal(pickBestMatch(query, [unrelated]), null);
  assert.equal(pickBestMatch(query, []), null);
});

test("an official artist video without duration info is a low-confidence match", () => {
  const official = {
    videoId: "eeeeeeeeeee",
    title: "Soda Stereo - De Música Ligera (Official Video)",
    channelTitle: "Soda Stereo",
    durationSeconds: null,
  };
  const best = pickBestMatch({ ...query, durationMs: null }, [official]);
  assert.equal(best?.videoId, official.videoId);
});

test("builds the search query from the first artist", () => {
  assert.equal(
    buildSearchQuery({ name: "Under Pressure", artists: ["Queen", "David Bowie"] }),
    "Queen Under Pressure",
  );
});

test("core title drops qualifiers", () => {
  assert.equal(coreTitle("Song (feat. X) - Remastered 2011"), "song");
  assert.equal(coreTitle("(I Can't Get No) Satisfaction"), "satisfaction");
});

test("parses ISO durations", () => {
  assert.equal(parseIsoDuration("PT3M25S"), 205);
  assert.equal(parseIsoDuration("PT1H2M"), 3720);
  assert.equal(parseIsoDuration("PT45S"), 45);
  assert.equal(parseIsoDuration("P0D"), 0);
  assert.equal(parseIsoDuration(""), null);
});

test("parses video ids from URLs", () => {
  assert.equal(parseVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1"), "dQw4w9WgXcQ");
  assert.equal(parseVideoId("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=x"), "dQw4w9WgXcQ");
  assert.equal(parseVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseVideoId("https://example.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(parseVideoId("not a url"), null);
});

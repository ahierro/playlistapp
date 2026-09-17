import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSearchQuery,
  isArtistChannel,
  needsUploadCheck,
  coreTitle,
  parseIsoDuration,
  parseSpotifyTrackId,
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

const music = (n, seconds = 210) =>
  Array.from({ length: n }, () => ({ categoryId: "10", durationSeconds: seconds }));
const other = (n) =>
  Array.from({ length: n }, () => ({ categoryId: "24", durationSeconds: 900 }));

test("Topic and VEVO channels are artists without looking at uploads", () => {
  assert.equal(isArtistChannel("Soda Stereo - Topic", []), true);
  assert.equal(isArtistChannel("QueenVEVO", []), true);
  assert.equal(needsUploadCheck("Soda Stereo - Topic", ["Music"]), false);
});

test("channels without a music topic are never artists", () => {
  assert.equal(isArtistChannel("Tech Reviews", ["Technology"], music(10)), false);
  assert.equal(needsUploadCheck("Tech Reviews", ["Technology"]), false);
});

test("a music-topic channel needs mostly Music uploads", () => {
  assert.equal(isArtistChannel("Some Band", ["Rock_music", "Music"], [...music(7), ...other(3)]), true);
  assert.equal(isArtistChannel("Music Reactions", ["Music"], [...music(2), ...other(8)]), false);
  assert.equal(isArtistChannel("Half And Half", ["Music"], [...music(5), ...other(5)]), false);
});

test("too few uploads fall back to requiring a specific genre", () => {
  assert.equal(isArtistChannel("New Artist", ["Pop_music"], music(1)), true);
  assert.equal(isArtistChannel("Empty Channel", ["Music"], []), false);
});

test("uploads longer than 10 minutes do not count as music", () => {
  // Music category, but hour-long: a music podcast or review channel.
  assert.equal(isArtistChannel("Music Podcast", ["Music"], music(10, 3600)), false);
  // A band that also posted two full concerts is still an artist.
  assert.equal(
    isArtistChannel("Live Band", ["Rock_music"], [...music(8), ...music(2, 5400)]),
    true,
  );
  // Exactly 10 minutes is still a song.
  assert.equal(isArtistChannel("Long Songs", ["Music"], music(10, 600)), true);
  // Unknown duration does not count against it.
  assert.equal(isArtistChannel("No Duration", ["Music"], music(10, null)), true);
});

test("parses Spotify track ids", () => {
  const id = "4iV5W9uYEdYUVa79Axb7Rh";
  assert.equal(parseSpotifyTrackId(`https://open.spotify.com/track/${id}?si=abc`), id);
  assert.equal(parseSpotifyTrackId(`https://open.spotify.com/intl-es/track/${id}`), id);
  assert.equal(parseSpotifyTrackId(`spotify:track:${id}`), id);
  assert.equal(parseSpotifyTrackId(id), id);
  assert.equal(parseSpotifyTrackId(`https://open.spotify.com/album/${id}`), null);
  assert.equal(parseSpotifyTrackId("https://example.com/track/" + id), null);
});

test("scores Spotify search results (artists as the channel)", () => {
  const fromYouTube = { name: "Crimen", artists: ["Gustavo Cerati"], durationMs: 233_000 };
  const studio = {
    videoId: "spotify:track:studio",
    title: "Crimen",
    channelTitle: "Gustavo Cerati",
    durationSeconds: 232.5,
  };
  const live = {
    videoId: "spotify:track:live",
    title: "Crimen - En Vivo",
    channelTitle: "Gustavo Cerati",
    durationSeconds: 260,
  };
  const other = {
    videoId: "spotify:track:other",
    title: "Crimen",
    channelTitle: "Some Cover Band",
    durationSeconds: 233,
  };
  const best = pickBestMatch(fromYouTube, [live, other, studio]);
  assert.equal(best?.videoId, studio.videoId);
  assert.equal(best?.confidence, "high");
});

import assert from "node:assert/strict";
import test from "node:test";

import { tallyUnfollowedArtists } from "./unfollowed-artists.ts";

const artist = (id, name = id) => ({
  id,
  name,
  uri: `spotify:artist:${id}`,
  url: `https://open.spotify.com/artist/${id}`,
});

const credit = (id, source, name) => ({ artist: artist(id, name), source });

test("drops the artists already followed", () => {
  const result = tallyUnfollowedArtists(
    [credit("a", "2025"), credit("b", "2025")],
    ["a"],
  );

  assert.deepEqual(result.map((entry) => entry.id), ["b"]);
});

test("counts one appearance per credit and sorts by count", () => {
  const result = tallyUnfollowedArtists(
    [
      credit("quiet", "2025"),
      credit("loud", "2025"),
      credit("loud", "2025"),
      credit("loud", "Liked songs"),
    ],
    [],
  );

  assert.deepEqual(
    result.map((entry) => [entry.id, entry.trackCount]),
    [
      ["loud", 3],
      ["quiet", 1],
    ],
  );
});

test("remembers where the songs are, most songs first", () => {
  const result = tallyUnfollowedArtists(
    [
      credit("a", "Liked songs"),
      credit("a", "2025"),
      credit("a", "2025"),
    ],
    [],
  );

  assert.deepEqual(result[0].sources, [
    { name: "2025", count: 2 },
    { name: "Liked songs", count: 1 },
  ]);
});

test("ties are broken by name", () => {
  const result = tallyUnfollowedArtists(
    [credit("2", "p", "Zeta"), credit("1", "p", "Alpha")],
    [],
  );

  assert.deepEqual(result.map((entry) => entry.name), ["Alpha", "Zeta"]);
});

test("keeps the same artist as one entry whatever the name says", () => {
  const result = tallyUnfollowedArtists(
    [credit("a", "p", "Charly García"), credit("a", "p", "Charly Garcia")],
    [],
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].trackCount, 2);
});

test("skips Various Artists", () => {
  const result = tallyUnfollowedArtists(
    [credit("0LyfQWJT6nXafLPZqxe9Of", "p", "Various Artists"), credit("a", "p")],
    [],
  );

  assert.deepEqual(result.map((entry) => entry.id), ["a"]);
});

test("an empty library gives an empty list", () => {
  assert.deepEqual(tallyUnfollowedArtists([], []), []);
});

import assert from "node:assert/strict";
import test from "node:test";

import { artistKey, compareArtistLists } from "./artist-compare.ts";

test("keys ignore case, accents and punctuation", () => {
  assert.equal(artistKey("Beyoncé"), artistKey("beyonce"));
  assert.equal(artistKey("Guns N' Roses"), artistKey("Guns N Roses"));
  assert.equal(artistKey("Simon & Garfunkel"), artistKey("Simon and Garfunkel"));
  assert.equal(artistKey("The Beatles"), artistKey("Beatles"));
});

test("keys drop the words channels add", () => {
  assert.equal(artistKey("Soda Stereo Oficial"), artistKey("Soda Stereo"));
  assert.equal(artistKey("Adele - Topic"), artistKey("Adele"));
  assert.equal(artistKey("QueenVEVO"), artistKey("QueenVEVO"));
  assert.equal(artistKey("Queen Official Music"), artistKey("Queen"));
});

test("a name made only of noise keeps something", () => {
  assert.ok(artistKey("Music").length > 0);
  assert.ok(artistKey("Topic").length > 0);
});

test("splits both lists and counts the shared ones", () => {
  const spotify = [
    { id: "s1", name: "Soda Stereo" },
    { id: "s2", name: "The Beatles" },
    { id: "s3", name: "Charly García" },
  ];
  const youtube = [
    { id: "y1", name: "Soda Stereo - Topic" },
    { id: "y2", name: "Beatles" },
    { id: "y3", name: "Nathy Peluso" },
  ];

  const result = compareArtistLists(spotify, youtube);
  assert.deepEqual(result.onlyInA.map((a) => a.id), ["s3"]);
  assert.deepEqual(result.onlyInB.map((a) => a.id), ["y3"]);
  assert.equal(result.shared, 2);
});

test("duplicates inside one list do not create false positives", () => {
  const result = compareArtistLists(
    [{ id: "a", name: "Adele" }, { id: "b", name: "adele" }],
    [{ id: "c", name: "Adele - Topic" }],
  );
  assert.equal(result.onlyInA.length, 0);
  assert.equal(result.onlyInB.length, 0);
  assert.equal(result.shared, 1);
});

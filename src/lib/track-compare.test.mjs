import assert from "node:assert/strict";
import test from "node:test";

import {
  artistKeys,
  compareTrackLists,
  titleKey,
  trackWords,
} from "./track-compare.ts";

const song = (name, ...artists) => ({ name, artists });

test("titles ignore case, accents, punctuation and qualifiers", () => {
  assert.equal(titleKey("Déjà Vu"), titleKey("deja vu"));
  assert.equal(titleKey("Song (feat. Drake)"), titleKey("Song"));
  assert.equal(titleKey("Song - Remastered 2011"), titleKey("Song"));
  assert.equal(titleKey("Song [Official Video]"), titleKey("Song"));
  assert.equal(titleKey("Simon & Garfunkel"), titleKey("Simon and Garfunkel"));
});

test("a title made only of a qualifier keeps something", () => {
  assert.ok(titleKey("(Intro)").length > 0);
  assert.ok(titleKey("- Live -").length > 0);
});

test("artist keys split the ways services cram several names together", () => {
  assert.deepEqual(artistKeys(["Calamaro, Charly García"]), ["calamaro", "charly garcia"]);
  assert.deepEqual(artistKeys(["Daft Punk feat. Pharrell"]), ["daft punk", "pharrell"]);
  assert.deepEqual(artistKeys(["The Beatles"]), ["beatles"]);
  assert.deepEqual(artistKeys(["Adele - Topic"]), ["adele"]);
});

test("same title and a shared artist is a match", () => {
  const spotify = [song("De Música Ligera", "Soda Stereo")];
  const youtube = [song("De Musica Ligera (Official Video)", "Soda Stereo - Topic")];

  const result = compareTrackLists(spotify, youtube);
  assert.equal(result.matched.length, 1);
  assert.equal(result.possible.length, 0);
  assert.deepEqual(result.onlyInA, []);
  assert.deepEqual(result.onlyInB, []);
});

test("same title by a different artist is only a possible match", () => {
  const result = compareTrackLists(
    [song("Hurt", "Nine Inch Nails")],
    [song("Hurt", "Johnny Cash")],
  );

  assert.equal(result.matched.length, 0);
  assert.equal(result.possible.length, 1);
  assert.equal(result.possible[0].reason, "title");
  assert.equal(result.possible[0].a.artists[0], "Nine Inch Nails");
  assert.equal(result.possible[0].b.artists[0], "Johnny Cash");
});

test("an artist in common wins over a same-title stranger", () => {
  const result = compareTrackLists(
    [song("Hurt", "Johnny Cash")],
    [song("Hurt", "Nine Inch Nails"), song("Hurt", "Johnny Cash")],
  );

  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].b.artists[0], "Johnny Cash");
  assert.deepEqual(result.onlyInB.map((track) => track.artists[0]), ["Nine Inch Nails"]);
});

test("each song is paired at most once", () => {
  const result = compareTrackLists(
    [song("Creep", "Radiohead"), song("Creep", "Radiohead")],
    [song("Creep", "Radiohead")],
  );

  assert.equal(result.matched.length, 1);
  assert.equal(result.onlyInA.length, 1);
});

test("splits both sides and keeps their order", () => {
  const spotify = [
    song("One", "A"),
    song("Two", "B"),
    song("Three", "C"),
  ];
  const youtube = [
    song("Three", "C"),
    song("Four", "D"),
    song("One", "A"),
  ];

  const result = compareTrackLists(spotify, youtube);
  assert.deepEqual(result.matched.map((pair) => pair.a.name), ["One", "Three"]);
  assert.deepEqual(result.onlyInA.map((track) => track.name), ["Two"]);
  assert.deepEqual(result.onlyInB.map((track) => track.name), ["Four"]);
});

test("word bags drop filler and duplicates", () => {
  assert.deepEqual(trackWords(song("Hard Road", "Explosions In The Sky")), [
    "explosions",
    "sky",
    "hard",
    "road",
  ]);
  assert.deepEqual(trackWords(song("Ghost", "Ghost")), ["ghost"]);
});

test("a song whose words all appear in the other is the same song", () => {
  const cases = [
    [
      song("Lachryma", "Ghost"),
      song("Lachryma // Ghost // Music Video [Sub Español]", "Stella BC"),
    ],
    [
      song("Au Pays du Cocaine", "Geese"),
      song("au pays du cocaine — geese; sub español.", "au pays du cocaine"),
    ],
    [
      song("Wrenches", "quannnic"),
      song('quannnic — "Wrenches" OFFICIAL VERSION', "quannnic"),
    ],
    [song("Cherry", "Slow Crush"), song('Slow Crush "Cherry"', "Pure Noise Records")],
    [
      song("Hard Road", "Explosions In The Sky"),
      song(
        "Explosions in the Sky | A Netflix Original Series |",
        "American Primeval 2024 Soundtrack | Hard Road",
      ),
    ],
  ];

  for (const [spotify, youtube] of cases) {
    const result = compareTrackLists([spotify], [youtube]);
    assert.equal(result.matched.length, 1, `${spotify.name} should match`);
    assert.equal(result.matched[0].reason, "contained");
    assert.deepEqual(result.onlyInA, []);
    assert.deepEqual(result.onlyInB, []);
  }
});

test("containment needs more than one meaningful word", () => {
  // "Ghost" alone would otherwise swallow every video mentioning a ghost.
  const result = compareTrackLists(
    [song("Ghost", "Ghost")],
    [song("Ghost Rider // Full Movie Reaction", "Some Channel")],
  );

  assert.equal(result.matched.length, 0);
  assert.equal(result.onlyInA.length, 1);
});

test("the tightest containment wins", () => {
  const result = compareTrackLists(
    [song("Lachryma", "Ghost")],
    [
      song("Lachryma // Ghost // Live at Wembley, Full Concert Encore", "Fans"),
      song("Lachryma // Ghost", "Stella BC"),
    ],
  );

  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].b.artists[0], "Stella BC");
  assert.equal(result.onlyInB.length, 1);
});

test("an exact title match is preferred over a containment one", () => {
  const result = compareTrackLists(
    [song("Lachryma", "Ghost")],
    [
      song("Lachryma // Ghost // Music Video", "Stella BC"),
      song("Lachryma", "Ghost"),
    ],
  );

  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].reason, "exact");
  assert.equal(result.onlyInB.length, 1);
});

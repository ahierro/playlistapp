import assert from "node:assert/strict";
import test from "node:test";

import { stripSpotifyEditionNoise } from "./spotify-title-cleaner.ts";

const noisyTitles = [
  ["Cathy's Clown - 2007 Remaster", "Cathy's Clown"],
  ["Exile On Main Street (2010 Re-Mastered)", "Exile On Main Street"],
  ["Album Title (Definitive Master)", "Album Title"],
  ["Album Title - Definitive Master", "Album Title"],
  ["Song Title - 2009 Re-Master", "Song Title"],
  ["Would? (2022 Remaster)", "Would?"],
  ["Spin (Norfolk Mix) [2023 Remaster]", "Spin (Norfolk Mix)"],
  [
    "Some Velvet Morning (feat. Kate Moss) - Single Mix - Remastered 2019",
    "Some Velvet Morning (feat. Kate Moss)",
  ],
  ["Song Title - Single Mix", "Song Title"],
  ["Body Movin' - Fatboy Slim Remix/Remastered 2009", "Body Movin' - Fatboy Slim Remix"],
  ["Soothe - Demo/Remastered", "Soothe - Demo"],
  ["Enough of You - Japan Bonus Track", "Enough of You"],
  ["Frogstomp (Deluxe Edition) [Remastered]", "Frogstomp"],
  ["Killing The Dragon (Deluxe Edition;2019 – Remaster)", "Killing The Dragon"],
  ["Rage Against The Machine - XX (20th Anniversary Special Edition)", "Rage Against The Machine"],
  ["Loaded: Re-Loaded 45th Anniversary Edition", "Loaded"],
  ["The Velvet Underground & Nico 45th Anniversary", "The Velvet Underground & Nico"],
  ["La Grasa de las Capitales: Edición 40º Aniversario (Remasterizado 2019)", "La Grasa de las Capitales"],
  ["Rated R - Deluxe Edition", "Rated R"],
  ["Sound of White Noise - Expanded Edition", "Sound of White Noise"],
  ["Piano Man (Legacy Edition)", "Piano Man"],
  ["Goat (Remaster / Reissue)", "Goat"],
];

for (const [input, expected] of noisyTitles) {
  test(`cleans ${JSON.stringify(input)}`, () => {
    assert.equal(stripSpotifyEditionNoise(input), expected);
  });
}

const officialTitles = [
  "(What's The Story) Morning Glory?",
  "Alexander the Great (356-323 B.C.)",
  "Version 2.0",
  "The 50th Anniversary Collection",
  "The Norfolk Remasters - Painful Thing",
  "Deluxe",
];

for (const title of officialTitles) {
  test(`preserves ${JSON.stringify(title)}`, () => {
    assert.equal(stripSpotifyEditionNoise(title), title);
  });
}

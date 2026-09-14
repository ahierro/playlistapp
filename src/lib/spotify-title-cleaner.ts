const EDITION_NOISE =
  /\b(?:re[-\s]?master(?:ed|ing)?|remasterizad[oa]?|anniversary|aniversario|deluxe|expanded|reissue|single\s+mix|special\s+edition|collector(?:'|’)?s\s+edition|legacy\s+edition|definitive\s+(?:edition|master)|bonus\s+(?:track|tracks|edition))\b/iu;

const TRAILING_BRACKETED_QUALIFIER =
  /\s*(?:\(([^()]*)\)|\[([^\[\]]*)\])\s*$/u;

const TRAILING_SLASH_REMASTER =
  /\s*\/\s*(?:(?:\d{4}\s+)?(?:digital(?:ly)?\s+|stereo\s+)?(?:re[-\s]?master(?:ed)?|remasterizad[oa]?)(?:\s+\d{4})?(?:\s+(?:version|edition))?)\s*$/iu;

const TRAILING_FREE_QUALIFIER = new RegExp(
  String.raw`\s+(?:` +
    [
      String.raw`(?:\d{4}\s+)?(?:digital(?:ly)?\s+|stereo\s+)?(?:re[-\s]?master(?:ed)?|remasterizad[oa]?)(?:\s+\d{4})?(?:\s+(?:version|edition))?`,
      String.raw`(?:\d+(?:st|nd|rd|th|º)?|\d+\s+year|golden)\s+(?:anniversary|aniversario)(?:\s+(?:(?:super\s+)?deluxe\s+)?(?:edition|re[-\s]?master))?`,
      String.raw`(?:anniversary|aniversario)\s+edition`,
      String.raw`(?:international\s+)?(?:super\s+)?deluxe(?:\s+(?:edition|version|reissue|re[-\s]?master|box\s+set))?`,
      String.raw`expanded(?:\s+(?:edition|version|reissue))?`,
      String.raw`single\s+mix`,
      String.raw`(?:special|collector(?:'|’)?s|legacy|bonus)\s+edition`,
      String.raw`definitive\s+(?:edition|master)`,
      String.raw`bonus\s+tracks?`,
      String.raw`reissue`,
    ].join("|") +
    String.raw`)\s*$`,
  "iu",
);

const TRAILING_SEPARATOR_SECTION =
  /^(.*)(?:\s+[-–—]\s*|:\s+)([^\r\n]+)$/u;

const TRAILING_ANNIVERSARY_MARKER =
  /\s+[-–—:]\s*(?:[IVXLCDM]+|\d{1,3}(?:st|nd|rd|th|º)?)\s*$/iu;

function containsEditionNoise(value: string): boolean {
  return EDITION_NOISE.test(value);
}

function removeDanglingSeparator(value: string): string {
  return value.replace(/\s+[-–—:;/]\s*$/u, "").trimEnd();
}

/**
 * Removes Spotify edition metadata from the end of a track or album title.
 *
 * The cleaner is intentionally suffix-based. Words such as "Remasters" or
 * "Anniversary" can be part of a real title, so they are only treated as noise
 * inside a trailing qualifier, after a separator, or in a known free-standing
 * edition phrase. No external catalogue lookup is needed.
 */
export function stripSpotifyEditionNoise(value: string): string {
  let current = value.trim();

  // More than one qualifier can be stacked, for example
  // "Frogstomp (Deluxe Edition) [Remastered]".
  while (current) {
    const previous = current;
    const bracketed = current.match(TRAILING_BRACKETED_QUALIFIER);

    const bracketedQualifier = bracketed?.[1] ?? bracketed?.[2];
    if (
      bracketed?.index !== undefined &&
      bracketedQualifier !== undefined &&
      containsEditionNoise(bracketedQualifier)
    ) {
      const anniversaryQualifier = /\b(?:anniversary|aniversario)\b/iu.test(
        bracketedQualifier,
      );

      current = current.slice(0, bracketed.index).trimEnd();

      // Handles labels such as "Album - XX (20th Anniversary Edition)".
      if (anniversaryQualifier) {
        current = current.replace(TRAILING_ANNIVERSARY_MARKER, "");
      }

      current = removeDanglingSeparator(current);
      continue;
    }

    // Keep meaningful variants in combined labels:
    // "Single Version / Remastered 2001" -> "Single Version".
    current = current.replace(TRAILING_SLASH_REMASTER, "").trimEnd();
    if (current !== previous) {
      current = removeDanglingSeparator(current);
      continue;
    }

    const separated = current.match(TRAILING_SEPARATOR_SECTION);
    if (separated && containsEditionNoise(separated[2])) {
      current = removeDanglingSeparator(separated[1]);
      continue;
    }

    current = current.replace(TRAILING_FREE_QUALIFIER, "").trimEnd();
    if (current !== previous) {
      current = removeDanglingSeparator(current);
      continue;
    }

    break;
  }

  // A title made entirely from an edition word may be legitimate, and there is
  // no base name to infer. Never turn it into an empty string.
  return current || value.trim();
}

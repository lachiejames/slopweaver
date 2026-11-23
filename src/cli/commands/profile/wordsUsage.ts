/**
 * `profile words`'s usage, a leaf both its manifest entry and its runner read, so the barrel stays metadata-only.
 */

/** The full `--help` text. */
export const PROFILE_WORDS_USAGE =
  "usage: slopweaver profile words [--phrase <words>] [--since <iso|7d|12h>] [--until <iso>] [--how spoken|written]\n" +
  "                                [--limit <n>] [--full] [--json] [--home <dir>] [--now <iso>]\n" +
  "       slopweaver profile words <anchor> [--json] [--home <dir>]\n" +
  "\n" +
  "Their own words — every turn they spoke on a console call or gave the console, and what they typed to each chair\n" +
  "while it held the supervisor pin — newest first, each with its instant, spoken or written, where, its length\n" +
  "and the anchor that reads it again.\n" +
  "\n" +
  "  --phrase  only turns holding every word of it (any order, any case, a plural counts)\n" +
  "  --since   from this instant, or this long ago (default 7d)\n" +
  "  --until   before this instant (default now)\n" +
  "  --how     spoken or written only\n" +
  "  --limit   at most this many turns (default 20, at most 500); the count above them is every match\n" +
  "  --full    each turn whole instead of a one-line preview\n" +
  "  --json    one JSON document instead of lines\n" +
  "  <anchor>  one record whole: talk:, talk-call:, call: or transcript:\n" +
  "\n" +
  "Spoken or written is how the conversation carried it: a turn they dictated into the supervisor reads written.\n" +
  "A spoken steer can be listed twice, once as the call stretch and once as the relay that reached a row.\n" +
  "Every record that would not read is named under the list. Exits 0 with a match, 3 with none and nothing\n" +
  "unread, 1 with none and something unread or when an anchor will not read, 2 on a usage mistake.\n" +
  "\n" +
  'example: slopweaver profile words --phrase "jumpcloud atlas" --since 1d';

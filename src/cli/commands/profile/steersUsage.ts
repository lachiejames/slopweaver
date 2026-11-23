/**
 * `profile steers`'s usage, a leaf both its manifest entry and its runner read, so the barrel stays metadata-only.
 */

/** The full `--help` text. */
export const PROFILE_STEERS_USAGE =
  "usage: slopweaver profile steers [--since <iso|60d>] [--until <iso>] [--json] [--home <dir>] [--now <iso>]\n" +
  "       slopweaver profile steers unread [--since <iso|60d>] [--until <iso>] [--limit <n>] [--json] [--home <dir>]\n" +
  "       slopweaver profile steers judge <anchor> --kind <kind> --says corrects|stopped --quote <words> [--home <dir>]\n" +
  "       slopweaver profile steers judge <anchor> --nothing [--home <dir>]\n" +
  "       slopweaver profile steers judge <anchor> --kind <kind> --withdraw [--home <dir>]\n" +
  "\n" +
  "Which kind of correction each turn from the owner names about the Slack drafts written as them — one point per turn per\n" +
  "kind, whatever it repeats — and the turns nobody has read for it yet. What the Alignment page's Slack chart draws.\n" +
  "\n" +
  "  (bare)    one line per kind: corrections, the last one, and days since; their own word that it stopped, apart\n" +
  "  unread    cued turns no session has read yet, oldest first, each whole — read them, then judge each\n" +
  "  judge     journal one read: the kind, whether they Correct it or says it STOPPED, and the words about it,\n" +
  "            verbatim from the turn (refused when the turn does not hold them); --nothing for a turn that names\n" +
  "            no kind; --withdraw to take back a wrong read\n" +
  "\n" +
  "  kinds     em-dashes, voice, length, stakeholders, proof, place, withheld\n" +
  "  --since   from this instant, or this long ago (default 60d)\n" +
  "  --limit   at most this many unread turns (default 20, at most 500)\n" +
  "\n" +
  "A turn is offered for reading when it holds a kind's cue beside a word placing it on Slack; the cue only chooses\n" +
  "what is read, never what is counted. A turn that only implies a pain names nothing.\n" +
  "\n" +
  "Every read lives in the store; judgement/steer-kinds.jsonl is imported once and refused if it changes after.\n" +
  "Exits 0, 1 when the store, that file or a quote would not read (never an empty reading), 2 on a usage mistake.\n" +
  "\n" +
  'example: slopweaver profile steers judge talk-call:<call>#<turn> --kind em-dashes --says corrects --quote "no em dashes"';

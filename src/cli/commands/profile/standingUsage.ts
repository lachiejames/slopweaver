/**
 * `profile standing`'s usage, a leaf both its manifest entry and its runner read, so the barrel stays metadata-only.
 */

/** The full `--help` text. */
export const PROFILE_STANDING_USAGE =
  "usage: slopweaver profile standing [--json] [--home <dir>]\n" +
  "       slopweaver profile standing add <id> --anchor <anchor> --covers <coverage,...> [--home <dir>]\n" +
  "       slopweaver profile standing withdraw <id> --reason <line> [--home <dir>]\n" +
  "\n" +
  "Their standing asks: the words a Queue card quotes when no particular steer of their produced it, so the card says\n" +
  "which ask it rests on and that no other steer is behind it. They live in the store; an old\n" +
  "judgement/standing-asks.jsonl is imported once, and refused if it changes after that.\n" +
  "\n" +
  "  (bare)    every standing ask, its words, where they said them and what it covers\n" +
  "  add       record one: their words are READ off --anchor (talk:, talk-call:, call: or transcript:) by the resolver\n" +
  "            `handover quote` uses, never typed — find the anchor with `slopweaver profile words`\n" +
  "  withdraw  take one off the cards it covers; the register keeps its event\n" +
  "\n" +
  "  --covers  comma-separated, each at most one active ask's: findings, registered-rows, bot-replies,\n" +
  "            unlinked-cards, or act:<kind> for one autonomy kind exactly\n" +
  "  --json    one document: {kind:read, active:[…]}, or {kind:defect, why} when the register does not read\n" +
  "  --now     the ISO instant add or withdraw records, in place of the wall clock\n" +
  "\n" +
  "Exits 0, 1 when the register or the anchor would not read or a write would break the register, 2 on a usage\n" +
  "mistake. --json exits 0 on a register that does not read: the defect is its document, which the console draws\n" +
  "on every card it would have quoted, and a non-zero exit would reach the console as no reading at all.\n" +
  "\n" +
  "example: slopweaver profile standing add organisation-intelligence --anchor talk:<turn> --covers findings";

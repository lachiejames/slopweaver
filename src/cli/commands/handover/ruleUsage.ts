/** `slopweaver handover rule`'s flags and help — a leaf, so `./ruleRun.ts` holds only the run. */

import { booleanFlagsOf, type FlagSpec, stringFlagsOf } from "../../parseFlags.js";

/** The flags `handover rule` accepts. */
export const RULE_FLAGS: FlagSpec = {
  boolean: ["explicit-steer", "standing-session"],
  string: [
    "anchor",
    "words",
    "decided-iso",
    "dir",
    "home",
    "gates",
    "gate-subject",
    "gate-until",
    "deliver-by",
    "standing-until",
    "attach-upload",
  ],
};

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_RULE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: RULE_FLAGS }),
  ...booleanFlagsOf({ spec: RULE_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** The verb's full help, printed by `--help` and under every usage refusal. */
export const HANDOVER_RULE_USAGE =
  "usage: slopweaver handover rule <slug> --anchor <where the owner said it> --words <the owner's words> " +
  '[--decided-iso <when the owner said it>] [--gates "<noun> <verb>, …"] [--gate-subject <a,b>] ' +
  "[--gate-until <iso>] [--explicit-steer [--deliver-by <iso>]] [--standing-session [--standing-until <iso>]] " +
  "[--attach-upload permitted|refused] [--dir <path>] [--home <dir>]\n" +
  "\n" +
  "Records the owner's ruling on a row as a `ruling` EVENT in its run journal — no document is written, and\n" +
  "every reader derives the owner's word from the register. Any row kind may be\n" +
  "ruled on, and a later ruling is appended beside the earlier one rather than refused.\n" +
  "\n" +
  "On a FINDING row this is also what opens the team-facing doors: until it is recorded, `github stack push`\n" +
  "on a team-reviewed base and `github pr request-review` refuse the row's branch, because a teammate must\n" +
  "not receive work the owner has not seen. A `no` is `handover settle <slug> --as declined`, not a ruling.\n" +
  "\n" +
  "A journal line this checkout cannot decode never refuses the owner's ruling: it is recorded beside the line, and the\n" +
  "verb states how many lines it skipped and, when one is a word this checkout predates, which word.\n" +
  "\n" +
  "--decided-iso is for a ruling relayed later than it was given; it defaults to now, and takes only the canonical\n" +
  "UTC spelling (2026-10-19T11:21:34.000Z). A row reads the ruling\n" +
  "with the LATEST decision instant, so recording an old one never supersedes a newer decision.\n" +
  "\n" +
  "--gates makes the ruling BITE: the named verbs refuse at run time, with the owner's words and this anchor, until\n" +
  "the owner releases the gate (a ruling must not depend on the chair remembering it across a\n" +
  "compaction). Exact `<noun> <verb>` pairs, comma-separated; there is no wildcard. --gate-subject narrows it\n" +
  "to named subjects (a recipe id, a channel) so a ruling about scheduled posts does not refuse every post;\n" +
  "--gate-until lapses it on its own, for a ruling that is only about today. Lift one with\n" +
  "`slopweaver handover gate release`; a later ruling with no gate is NOT a release.\n" +
  "\n" +
  "--explicit-steer marks the ruling as the owner's EXPLICIT STEER: an owner who says they are overriding earlier\n" +
  "guidance overrides every standing rule and memory for this row's instance only\n" +
  "(docs/doctrine-rationale/explicit-steer.md). The steered row is watched by the\n" +
  "`steer-at-risk` monitor, so a deliverable at risk raises a floating note and a voice line early.\n" +
  "--deliver-by names the instant the owner said it must exist, canonical UTC; it needs --explicit-steer.\n" +
  "\n" +
  "--standing-session makes the row's seat a STANDING SESSION: the owner keeps talking to it, so it stays open between their\n" +
  "turns. `session close-done` never parks it, `handover park` refuses it, and the chair's reconcile reads it\n" +
  "ready to seat again when it is found parked. An ordinary later ruling does NOT end it; --standing-until names\n" +
  "the instant it ends, canonical UTC, and a later --standing-session ruling whose --standing-until is already\n" +
  "past ends it at once. A reconstruction can neither make nor end one.\n" +
  "\n" +
  "--attach-upload records the owner's word on `github attach upload`, which sends no picture or recording off this\n" +
  "machine until a ruling PERMITS it. The latest live --attach-upload ruling on any row decides, so a later\n" +
  "`refused` closes the door again. There is no environment override; this ruling is the only way past.\n" +
  "\n" +
  'example: slopweaver handover rule watchpr-dies-silent --anchor <slack permalink> --words "yes, raise it on staging"';

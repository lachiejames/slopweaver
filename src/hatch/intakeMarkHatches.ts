/**
 * The escape-hatch row `slopweaver supervisor intake-mark` reads: one free-text witness spread across too many of the owner's
 * turns (`../supervisor/intakeWitness.ts` carries the 183-turn measurement).
 *
 * A sibling of `./registry.ts` for the reason `./talkHatches.ts` gives: the register sheds a surface to its own file
 * rather than grow past `file-size-ratchet`. `ESCAPE_HATCHES` spreads it back in, so there is still exactly ONE
 * register.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch `supervisor intake-mark` reads. */
export const INTAKE_MARK_HATCHES = [
  {
    caught:
      "the same free-text witness already marks three other turns, and one string spread across many turns cleared 183 " +
      "of the owner's steers in six minutes while masking the specific mark each one already had — name the " +
      "row slug, the URL, the PR or the turn pointer this turn became instead, which is never refused",
    command: "slopweaver supervisor intake-mark",
    exceptions: [
      "a one-off audited repair of the ledger where every turn named was checked by hand and no per-turn reference survives",
      "a fixed reason a whole class of turns shares by construction — a spawn's own pickup line typed by cmux spawn",
    ],
    id: "intake-witness-reuse",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_INTAKE_WITNESS_REUSE" },
    lane: "ambient",
    reader: "src/cli/commands/supervisor/intakeMarkRun.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];

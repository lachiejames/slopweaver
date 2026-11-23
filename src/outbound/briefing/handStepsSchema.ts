/**
 * The hand-steps section's own schema — one open step, and the section that holds them.
 *
 * Split out of `./schema.ts` for the reason `./autonomySchema.ts` was: that file sits against the code-line
 * cap `file-size-ratchet` enforces, and this section is a PROJECTION of a register
 * (`../../briefing/handSteps.ts`) rather than prose a supervisor composed, so nothing here shares a
 * vocabulary helper with a composed cell. The whole page's form still assembles in `./schema.ts`.
 *
 * ## The caps are the REGISTER's, imported rather than restated
 *
 * Every length bound here comes from `../../hand/step.ts`, which is what `slopweaver hand post` already
 * enforced on the way in. A second number here would mean a step the register accepted could not reach the
 * page — a silent hole exactly where the owner is waiting for a command — so the two are one constant with
 * one home. The only bound this file owns is the row COUNT, and that is a page question rather than a
 * register one.
 */
import { z } from "zod";

import { HAND_STEPS_MAX_ROWS } from "../../briefing/caps.js";
import { wordCount } from "../../briefing/text.js";
import { CHECKLIST_ACTION_CAP, CHECKLIST_MAX, FIND_PART_CAP, FIND_PARTS_MAX } from "../../hand/checklist.js";
import { WHAT_CAP, WITNESS_CAP } from "../../hand/step.js";
import { LITERAL_CAP } from "../../hand/stepAddress.js";
import { TIER_ORDER } from "../../waiting/rank.js";
import { strictForm } from "../strictForm.js";

import type { BriefingHandStepRow } from "./types.js";

import { proseLine } from "./vocabulary.js";

/** The longest a step's `unblocks` may run. The register does not bound it; the page does. */
const UNBLOCKS_MAX = 400;

/** The longest a step's `where` may run — a place, not a paragraph. */
const WHERE_MAX = 200;

/** The longest a step's URL may run, matching what a link cell elsewhere on this page accepts. */
const URL_MAX = 500;

/** The longest a step id may run. Slug-shaped, and what `slopweaver hand done <id>` is typed with. */
const ID_MAX = 120;

/**
 * An instant a row states: ISO-8601, and one a `Date` actually parses.
 *
 * The same four lines `./autonomySchema.ts` spells for the same reason — importing it from `./schema.ts`
 * would make the two modules circular, and a shared home for four lines is ceremony over a rule both files
 * can hold.
 */
const instant = z
  .string()
  .min(1)
  .max(40)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "a hand step's `postedIso` must be an ISO-8601 timestamp a clock can parse, as in `2026-09-21T00:40:18Z`.",
  });

/**
 * One open step in the hand-steps section.
 *
 * `literal` is deliberately NOT a `proseLine`: it is the bytes the owner pastes into a shell, so a numbered set of
 * lines is a script rather than the packed enumeration that rule refuses, and the renderer puts it in a
 * `<pre>` so every byte survives. Everything the owner READS — `what`, `unblocks`, `where` — is a prose line,
 * so a step that trails off in an ellipsis is refused rather than reaching the page as a cut that cannot be finished.
 */
const handStepRowSchema = strictForm({
  // The register's own bounds, re-checked by the register's own reader: one sentence and at most one paste per line.
  checklist: z
    .array(
      strictForm({
        action: z.string().min(1).max(CHECKLIST_ACTION_CAP),
        command: z.string().min(1).max(LITERAL_CAP).optional(),
        find: z.array(z.string().min(1).max(FIND_PART_CAP)).min(1).max(FIND_PARTS_MAX).optional(),
        url: z.string().min(1).max(URL_MAX).optional(),
      }),
    )
    .min(1)
    .max(CHECKLIST_MAX)
    .optional(),
  id: z.string().min(1).max(ID_MAX),
  literal: z.string().min(1).max(LITERAL_CAP).optional(),
  postedIso: instant,
  tier: z.enum(TIER_ORDER),
  unblocks: proseLine.max(UNBLOCKS_MAX),
  url: z.string().min(1).max(URL_MAX).optional(),
  what: proseLine.max(WHAT_CAP),
  where: proseLine.max(WHERE_MAX).optional(),
  witness: z.string().min(1).max(WITNESS_CAP),
});

/**
 * The hand-steps section: the open steps this page shows, and an honest count of the ones it does not.
 *
 * Ranked, then oldest first WITHIN a tier, is refused rather than assumed. The tiers come first because the owner asked
 * to be led to what blocks a colleague before anything else (`../../waiting/rank.ts`); a check-in never
 * leads. Inside a tier the direction is the OPPOSITE of the autonomy ledger's on purpose. That section answers "what happened most recently"; this one answers "what have you been
 * sitting on", and the step that has waited longest is the one the page should lead with — the trelica
 * sign-in had been open 14.8 days when this section was built.
 *
 * A duplicate id is refused for the reason the autonomy ledger refuses a duplicate act id: the id is what the owner
 * types into `slopweaver hand done`, and a page showing one step twice makes that name ambiguous.
 */
export const handStepsSchema = strictForm({
  notShown: z.number().int().min(0),
  rows: z
    .array(handStepRowSchema)
    .max(HAND_STEPS_MAX_ROWS, {
      message:
        `the hand-steps section shows at most ${String(HAND_STEPS_MAX_ROWS)} steps. The register keeps all ` +
        "of them — project the oldest, and let `notShown` state how many are not on this page.",
    })
    .refine(
      (rows) =>
        rows.every((row, index) => {
          const previous = rows[index - 1];
          if (previous === undefined) {
            return true;
          }
          const rise = TIER_ORDER.indexOf(row.tier) - TIER_ORDER.indexOf(previous.tier);
          return rise > 0 || (rise === 0 && Date.parse(previous.postedIso) <= Date.parse(row.postedIso));
        }),
      {
        message:
          "the hand steps are not ranked, oldest first within a tier. The projection ranks the register's " +
          "posting order, so a section in any other order was re-sorted on the way here.",
      },
    )
    .refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length, {
      message:
        "two rows of the hand-steps section carry the same step id, so `slopweaver hand done <id>` could " +
        "not say which one it settles. Fold the register before projecting it.",
    }),
  unreadable: z.number().int().min(0),
});

/**
 * The words one hand step puts above the fold: its visible line and nothing else.
 *
 * `unblocks`, `witness` and the command itself are absent because they are inside the row's fold — the same
 * arithmetic `./autonomySchema.ts`'s `autonomyRowAboveFoldWords` makes about an act's `why`. The id IS
 * charged, unlike an act's raw subject, because it is on the visible line: it is what the owner types back.
 *
 * @internal — read by the form's own page budget; no caller outside `./schema.ts` names it.
 *
 * @param row one projected step
 * @returns the word count a reader meets without expanding the row
 */
export function handStepRowAboveFoldWords({ row }: { row: BriefingHandStepRow }): number {
  return wordCount({ text: `${row.id} ${row.what}` });
}

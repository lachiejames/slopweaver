/**
 * The autonomy ledger section's own schema — one act, and the section that holds them.
 *
 * Split out of `./schema.ts` rather than living beside every other section, because that file had reached the
 * 600-code-line cap `file-size-ratchet` enforces and this section is the one real seam in it: its rows are a
 * PROJECTION of a register (`../../briefing/autonomy.ts`) rather than prose a supervisor composed, so nothing
 * here shares a vocabulary helper with a composed cell. The whole page's form still assembles in `./schema.ts`.
 */
import { z } from "zod";

import { isCheckableSubject } from "../../autonomy/fields.js";
import {
  AUTONOMY_ACTION_ID_MAX,
  AUTONOMY_KIND_MAX,
  AUTONOMY_RUN_MAX,
  AUTONOMY_SAID_MAX,
  AUTONOMY_SESSION_MAX,
  AUTONOMY_SUBJECT_MAX,
} from "../../autonomy/types.js";
import {
  AUTONOMY_MAX_ROWS,
  AUTONOMY_SESSION_LABEL_MAX_CHARS,
  AUTONOMY_SUBJECT_LABEL_MAX_CHARS,
} from "../../briefing/caps.js";
import { wordCount } from "../../briefing/text.js";
import { strictForm } from "../strictForm.js";
import type { BriefingAutonomyRow } from "./types.js";
import { proseLine } from "./vocabulary.js";

/**
 * An instant a section states: a non-empty string of at most 40 characters that a `Date` parses. The SHAPE is
 * not checked here, so a non-ISO spelling `Date` accepts passes; its refusal message names ISO-8601 all the same.
 *
 * The same check `./schema.ts`'s eyebrow instants carry, spelled here rather than imported because importing
 * it would make this module and that one circular — and it is four lines, so a shared home for it would be
 * ceremony over a rule both files can hold.
 */
const instant = z
  .string()
  .min(1)
  .max(40)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "an act's instant must be an ISO-8601 timestamp a clock can parse, as in `2026-09-12T02:06:09Z`.",
  });

/**
 * A subject the page will carry: whatever `../../autonomy/subject.ts` classifies, and nothing else.
 *
 * The predicate rather than `z.url()`, which used to stand here and disagreed with the domain in BOTH
 * directions — it admitted protocols `isCheckableSubject` refuses, and refused the board row slugs eleven
 * real acts in the live register carry. One rule, three readers: this schema, the parser, and the renderer
 * that decides whether a subject becomes a link.
 */
const subjectIdentifier = z
  .string()
  .min(1)
  .max(AUTONOMY_SUBJECT_MAX)
  .refine((value) => isCheckableSubject({ subject: value }), {
    message:
      "an act's subject must be a checkable id: an absolute http(s) URL, a handover board row slug, or " +
      "`state:<path>` for a file under the state home.",
  });

/**
 * One act in the autonomy ledger's section.
 *
 * ## What is capped, and what deliberately is not
 *
 * Only the three DERIVED labels a reader meets on the visible line carry a length bound, and `subjectLabel`
 * and `sessionLabel` are computed by `../../autonomy/label.ts` rather than written, so those bounds refuse a
 * pathological URL rather than a composer's prose. `why`, `witness` and `steer` are UNCAPPED, which is the
 * fold ruling applied: they render inside a fold nothing forces the owner through, and a cap that made
 * a session abbreviate the reasoning the owner steers against would cost the exact thing the autonomy ruling
 * asked for. What bounds their weight is `../../briefing/caps.ts`'s `PAGE_TEXT_MAX_BYTES`, the same backstop every
 * other fold on the page has.
 *
 * `said` is the one folded field that IS capped, and the cap is not this schema's judgement: the register
 * refuses a `--said` past `AUTONOMY_SAID_MAX` at the door, so a row arriving here over it was not written by
 * `slopweaver autonomy record`. Restating the register's own bound is what makes that visible rather than
 * rendering a line the verb would never have accepted.
 *
 * `doneIso` is an {@link instant} rather than a stamp a composer writes, exactly as an open artifact's
 * `landedIso` is: this section's whole question is what happened most recently, and a clock reading a
 * composer supplies is one that can be wrong.
 */
const autonomyRowSchema = strictForm({
  actionId: z.string().min(1).max(AUTONOMY_ACTION_ID_MAX),
  bySession: proseLine.max(AUTONOMY_SESSION_MAX),
  doneIso: instant,
  kindLabel: proseLine.max(AUTONOMY_KIND_MAX),
  run: z.string().min(1).max(AUTONOMY_RUN_MAX).optional(),
  said: z.string().min(1).max(AUTONOMY_SAID_MAX).optional(),
  sessionLabel: proseLine.max(AUTONOMY_SESSION_LABEL_MAX_CHARS),
  steer: z.string().min(1).optional(),
  subject: subjectIdentifier,
  subjectLabel: proseLine.max(AUTONOMY_SUBJECT_LABEL_MAX_CHARS),
  why: z.string().min(1),
  witness: z.string().min(1),
});

/**
 * The autonomy ledger section: the acts this page shows, and an honest count of the ones it does not.
 *
 * Newest first is refused rather than assumed. The register's own fold already orders the acts
 * (`../../autonomy/query.ts`), so a section arriving in any other order means something composed or
 * re-sorted it on the way here — which is the one thing this section may not be.
 *
 * A duplicate `actionId` is refused for the reason the open-artifact index refuses a duplicate URL: the id is
 * what the owner names when giving a steer, and a page showing one act twice is a page where that name is
 * ambiguous.
 */
export const autonomySchema = strictForm({
  notShown: z.number().int().min(0),
  rows: z
    .array(autonomyRowSchema)
    .max(AUTONOMY_MAX_ROWS, {
      message:
        `the autonomy ledger shows at most ${String(AUTONOMY_MAX_ROWS)} acts. The register keeps all of ` +
        "them — project the newest, and let `notShown` state how many are not on this page.",
    })
    .refine(
      (rows) =>
        rows.every((row, index) => {
          const previous = rows[index - 1];
          return previous === undefined || Date.parse(previous.doneIso) >= Date.parse(row.doneIso);
        }),
      {
        message:
          "the autonomy ledger's acts are not newest first. The register folds them in that order already, " +
          "so a section in any other order was re-sorted on the way here.",
      },
    )
    .refine((rows) => new Set(rows.map((row) => row.actionId)).size === rows.length, {
      message:
        "two rows of the autonomy ledger carry the same act id, so a steer naming it could not say which " +
        "row it judges. Fold the register before projecting it.",
    }),
});

/**
 * The words one autonomy row puts above the fold: its visible line and nothing else.
 *
 * `why`, `witness` and `steer` are absent because they are inside the row's fold, which is the same
 * arithmetic {@link yourRowAboveFoldWords} already makes about a row's `detail`. `subject` and `bySession`
 * are absent for a different reason: they are the raw values the fold shows, and the line reads their
 * derived labels.
 *
 * @internal — read by this file's own page budget; no caller outside the form names it.
 *
 * @param row one projected act
 * @returns the word count a reader meets without expanding the row
 */
export function autonomyRowAboveFoldWords({ row }: { row: BriefingAutonomyRow }): number {
  return wordCount({ text: `${row.kindLabel} ${row.subjectLabel} ${row.sessionLabel}` });
}

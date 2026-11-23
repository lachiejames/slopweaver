/**
 * The owner's GENERAL RULINGS — step (b) of the tag decision tree: a kind of ask the owner has already ruled on, so
 * the bot acts on it with no wait, whoever asked.
 *
 * PURE: a decoded value in, the rulings out. The tree that renders them is `./tagDecisionTree.ts`.
 *
 * ## Per install, never in this repository
 *
 * Each install is independently owned (`docs/constraints/partition.md`), and a ruling is one owner's word
 * about what the owner's bot may do. Compiled into the shared source, one owner's rulings would license work in every
 * colleague's install that none of them approved. So the rulings live in `$SLOPWEAVER_HOME`, exactly as the
 * trusted tier does (`../listen/trustedTier.ts`), and an install with no file has no rulings: step (b)
 * covers nothing, and every ask falls through to (c) or (d).
 *
 * A ruling enters the file only when the owner made it AS a ruling over a kind of ask — a past approval of one
 * ask is never a grant — and each carries the anchor of the owner's words, so a session reads the ruling rather than
 * trusting the paraphrase.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";

/** The file the general rulings live in, under `$SLOPWEAVER_HOME`. */
export const GENERAL_RULINGS_FILE = "general-rulings.json";

/** One general ruling: the kind of ask it covers, what the bot does, and where the owner said it. */
export interface GeneralRuling {
  /** The kind of ask, as a session would recognise it in a thread. */
  readonly kind: string;
  /** What the bot does, with every condition the owner attached. */
  readonly act: string;
  /** The anchor of the owner's words, so a session can read the ruling rather than trust the paraphrase. */
  readonly anchor: string;
}

/** The loaded rulings: a list, or the fact that the file is absent or could not be read. */
export type GeneralRulings =
  | { readonly kind: "absent" }
  | { readonly kind: "list"; readonly rulings: readonly GeneralRuling[] }
  | { readonly kind: "unreadable"; readonly why: string };

const NOT_AN_ARRAY = `${GENERAL_RULINGS_FILE} must be a JSON array of { kind, act, anchor } objects`;

const nonBlank = ({ field }: { field: string }) =>
  z.string({ error: NOT_AN_ARRAY }).regex(/\S/, `every ${field} in ${GENERAL_RULINGS_FILE} must be non-blank`);

const generalRulingsSchema = z.array(
  z.strictObject(
    {
      act: nonBlank({ field: "act" }),
      anchor: nonBlank({ field: "anchor" }),
      kind: nonBlank({ field: "kind" }),
    },
    { error: NOT_AN_ARRAY },
  ),
  { error: NOT_AN_ARRAY },
);

/**
 * Parse an already-decoded JSON value into the rulings, in the order the file gives them.
 *
 * Strict: one malformed entry refuses the WHOLE file rather than being dropped, because a ruling silently
 * dropped is a kind of ask the owner believes the bot acts on and it does not, and an unknown key may be a
 * condition the owner attached that nothing would read.
 *
 * @param value a parsed JSON value (e.g. from `readFileSync` + `parseJson`)
 * @returns the rulings, or every reason the file was refused
 */
export function parseGeneralRulings({ value }: { value: unknown }): Result<readonly GeneralRuling[]> {
  const parsed = generalRulingsSchema.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => issue.message));
  }
  return ok(parsed.data);
}

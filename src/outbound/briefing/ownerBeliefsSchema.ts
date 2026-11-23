/**
 * The correction block's own schema — one proposed belief, and the block that holds them.
 *
 * Split out of `./schema.ts` rather than living beside every other section, for the reason
 * `./autonomySchema.ts` was: that file is at the code-line cap `file-size-ratchet` enforces, and this block
 * is a real seam in it. Its rows are a PROJECTION of the proposal queue (`../../briefing/ownerBeliefs.ts`)
 * rather than prose a supervisor composed, so nothing here shares a vocabulary helper with a composed cell.
 * The whole page's form still assembles in `./schema.ts`.
 */
import { z } from "zod";

import { OWNER_BELIEF_CLAIM_MAX_CHARS, OWNER_BELIEFS_MAX_ROWS } from "../../briefing/caps.js";
import { wordCount } from "../../briefing/text.js";
import { BELIEF_HOLDS } from "../../knowledge/voice/types.js";
import { strictForm } from "../strictForm.js";

import type { BriefingOwnerBeliefsRow } from "./types.js";
import { proseLine } from "./vocabulary.js";

/**
 * An instant a row states: a non-empty string of at most 40 characters that a `Date` actually parses.
 *
 * The refusal message asks for ISO-8601, but the check is `new Date(value)` alone, so a non-ISO string a
 * `Date` still parses (`01/12/2030`) is accepted.
 *
 * The same check `./autonomySchema.ts` spells, and spelled here for its reason rather than shared: importing
 * it from that module would tie two independent sections together so that retiring either one breaks the
 * other. Four lines is cheaper than that coupling.
 */
const instant = z
  .string()
  .min(1)
  .max(40)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "a proposal's instant must be an ISO-8601 timestamp a clock can parse, as in `2026-09-12T02:06:09Z`.",
  });

/** A queue id: the `p-` or `u-` prefix the store writes, and the hex digest behind it. */
const queueId = z.string().regex(/^[pu]-[0-9a-f]{16}$/u, {
  message:
    "a correction row's ids are the queue's own: `p-` or `u-` and sixteen hex characters. One that is not " +
    "is a row nothing wrote, so `slopweaver knowledge answer` could never find it.",
});

/**
 * One proposed belief in the correction block.
 *
 * ## What is capped, and what deliberately is not
 *
 * The CLAIM carries the queue's own bound and nothing tighter — see
 * `../../briefing/caps.ts`'s {@link OWNER_BELIEF_CLAIM_MAX_CHARS} for why a page-specific number here would
 * make a valid recorded proposal unrenderable. The QUOTE is uncapped, because it is inside the fold and it
 * is the owner's own words: the fold ruling says a cap that makes a session abbreviate what it folded
 * optimises for a counter rather than for a reader, and abbreviating the owner's words would be worse than
 * that — it would put a paraphrase on the page under a heading that says these are the owner's. What bounds their weight
 * is `PAGE_TEXT_MAX_BYTES`, the same backstop every other fold has.
 *
 * `reviewedAtIso` is an {@link instant} rather than a stamp a composer writes, exactly as an open artifact's
 * `landedIso` is: how long a belief has sat unanswered is the thing this block is asking about, and a clock
 * reading a composer supplies is one that can be wrong.
 */
const ownerBeliefRowSchema = strictForm({
  claim: proseLine.max(OWNER_BELIEF_CLAIM_MAX_CHARS),
  domain: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
    .min(2)
    .max(40),
  held: z.enum(BELIEF_HOLDS),
  proposalId: queueId,
  quote: z.string().min(1),
  reviewedAtIso: instant,
  unitId: queueId,
  wrapped: z.boolean(),
});

/**
 * The correction block: the proposals this page shows, and an honest count of the ones it does not.
 *
 * A duplicate `proposalId` is refused for the reason the autonomy ledger refuses a duplicate act id: the id
 * is what the owner names when answering, and a page showing one proposal twice is a page where that name is
 * ambiguous. `../../knowledge/voice/unit.ts`'s `openProposals` already collapses them, so a duplicate
 * reaching here means something re-assembled the block on the way.
 *
 * Order is NOT constrained. That is the opposite call the autonomy ledger makes and it is deliberate: acts
 * are newest-first because recency is what the owner steers on, while an open proposal has no such ordering — the
 * queue hands them over in the order they were proposed, and imposing a second rule here would let this page
 * disagree with `slopweaver knowledge propose` about which belief is next.
 */
export const ownerBeliefsSchema = strictForm({
  notShown: z.number().int().min(0),
  rows: z
    .array(ownerBeliefRowSchema)
    .max(OWNER_BELIEFS_MAX_ROWS, {
      message:
        `the correction block shows at most ${String(OWNER_BELIEFS_MAX_ROWS)} beliefs. The queue keeps all ` +
        "of them — project the oldest open ones, and let `notShown` state how many are not on this page.",
    })
    .refine((rows) => new Set(rows.map((row) => row.proposalId)).size === rows.length, {
      message:
        "two rows of the correction block carry the same proposal id, so the owner's answer naming it could not say " +
        "which row it marks. Project the queue's open proposals rather than re-assembling them.",
    }),
});

/**
 * The words one correction row puts above the fold: its visible line and nothing else.
 *
 * The quote, the unit and the hold are absent because they are inside the row's fold, which is the same
 * arithmetic `./autonomySchema.ts`'s `autonomyRowAboveFoldWords` makes. The domain and the claim are what the owner
 * meets, and the proposal id is charged with them — it is on the line precisely so the owner can name it.
 *
 * @internal — read by the form's own page budget; no caller outside the form names it.
 *
 * @param row one projected proposal
 * @returns the word count a reader meets without expanding the row
 */
export function ownerBeliefRowAboveFoldWords({ row }: { row: BriefingOwnerBeliefsRow }): number {
  return wordCount({ text: `${row.domain} ${row.claim} ${row.proposalId}` });
}

/**
 * The INLINE RUN vocabulary as Zod — the smallest thing an artifact says, and the two unions that hold it.
 *
 * Split out of `./schema.ts` when the `group` run landed and that file crossed the 600-code-line ratchet.
 * The seam is a real one rather than a place to cut: everything here is about ONE run, while everything
 * left there is about a whole card — its caps, its citation integrity, its truncation policy, its fold. The
 * two unions live here too, because the reason they are spelled as two lists rather than a subtraction is a
 * property of the runs themselves (see {@link dripInlineRunSchema}).
 *
 * `./schema.ts` re-exports what it always exported, so nothing importing from there had to change.
 */
import { z } from "zod";

import { strictForm } from "../strictForm.js";
import { isVantaPolicyDocumentUrl, vantaPolicyDocumentRefusal } from "./vantaLinks.js";

/**
 * Every clickable URL in the vocabulary, with the one address an outbound message may not carry refused.
 *
 * Declared here rather than inline on the `link` run because `./schema.ts`'s `primaryLink` is the one
 * clickable URL that is NOT a run, and the two must not be able to drift apart. Why this address is
 * refused, and what to link instead: `./vantaLinks.ts`.
 */
export const clickableUrlSchema = z.url().refine((url) => !isVantaPolicyDocumentUrl({ url }), {
  error: vantaPolicyDocumentRefusal(),
});

/**
 * A text run. Exported with the link and mention runs because `./noFoldSchema.ts` lists these three as its
 * own narrower union and must not hold a second copy of any of them.
 */
export const textSpanRunSchema = strictForm({
  bold: z.boolean().optional(),
  code: z.boolean().optional(),
  italic: z.boolean().optional(),
  // `TextSpan.quoted` is deliberately NOT here. A composer filling this form could otherwise mark its own
  // prose as somebody else's and walk past the voice rules; only a DERIVATION may set it, in code, and the
  // one derived card this schema re-validates strips it first (`alertSummary.ts`'s `withoutQuotedFlags`).
  text: z.string().min(1),
  type: z.literal("text"),
});

/** The most characters a link run's label may carry; a composer fitting someone else's title to it reads this. */
export const LINK_LABEL_MAX = 120;

/** A link run, its URL graded by {@link clickableUrlSchema}. */
export const linkRunSchema = strictForm({
  bold: z.boolean().optional(),
  label: z.string().min(1).max(LINK_LABEL_MAX),
  type: z.literal("link"),
  url: clickableUrlSchema,
});

/** A person mention. */
export const mentionRunSchema = strictForm({
  person: z.string().min(1),
  type: z.literal("mention"),
});

/**
 * A user-group mention. `handle` is a KEY, not markup — the send path resolves it against the structure
 * index and refuses a group that is disabled, empty, unknown, or named rather than handled.
 */
const groupRunSchema = strictForm({
  handle: z.string().min(1),
  type: z.literal("group"),
});

const broadcastRunSchema = strictForm({
  range: z.enum(["here", "channel"]),
  type: z.literal("broadcast"),
});

const citationRunSchema = strictForm({
  citationId: z.string().min(1),
  type: z.literal("citation"),
});

/** Every inline run. A discriminated union so an impossible run cannot be constructed. */
export const inlineRunSchema = z.discriminatedUnion("type", [
  textSpanRunSchema,
  linkRunSchema,
  mentionRunSchema,
  groupRunSchema,
  broadcastRunSchema,
  citationRunSchema,
]);

/**
 * The inline runs an AS-ME message may carry: everything except a `[n]` citation chip.
 *
 * Built by listing them rather than by subtracting one, because Zod's `discriminatedUnion` has no
 * "omit" and a subtraction expressed as a runtime filter would type as the wider union anyway. The cost is
 * that adding a run type means touching two lists; the benefit is that the citation chip is
 * unrepresentable here rather than merely unpopular. See `./types.ts`'s `DripInlineRun`.
 */
export const dripInlineRunSchema = z.discriminatedUnion("type", [
  textSpanRunSchema,
  linkRunSchema,
  mentionRunSchema,
  groupRunSchema,
  broadcastRunSchema,
]);

/** One run sequence: at least one run, because an empty sequence renders nothing at all. */
export const runsSchema = z.array(inlineRunSchema).min(1);

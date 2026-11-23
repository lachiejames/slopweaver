/**
 * What a browser walk saw one declared PAGE be — the shape every walking atlas records, as a schema and as
 * the accounting behind it.
 *
 * This is not a platform's vocabulary. Whether a declared page was reached, where the client actually
 * settled, how many of its own calls it made, and how much of its own traffic the walk could account for are
 * facts about walking a page, and the Notion and Trelica atlases had each declared them identically.
 *
 * ## The accounting is here rather than reduced to a boolean, and that is the point
 *
 * "Not complete" is a silence; "eligible 14, kept 12, lost 2" is a number somebody can act on. A walk that
 * silently dropped two of twelve response bodies otherwise looks exactly like one that kept them all, so
 * the four counts are stored rather than folded.
 *
 * The screenshot is deliberately NOT here: it is an artifact on the entity's own source, addressed by
 * digest, because the ruling is that an atlas holds the picture rather than a link to one.
 */
import { z } from "zod";

/**
 * What a walk saw against what it kept, so incompleteness is a number rather than a silence.
 *
 * @internal
 */
export const atlasResponseAccountingSchema = z
  .object({
    bodyFailed: z.number().int().nonnegative(),
    bodySucceeded: z.number().int().nonnegative(),
    eligible: z.number().int().nonnegative(),
    seen: z.number().int().nonnegative(),
  })
  .strict();

/**
 * What the browser saw one declared page be.
 *
 * `unreachableBecause` is what makes a declared page that the client would not render a recorded ROW rather
 * than a silent absence — the whole reason a walk is judged against a declared list it did not choose.
 */
export const atlasPageDetailSchema = z
  .object({
    /** How many first-party calls this page caused while it was being walked. */
    callCount: z.number().int().nonnegative(),
    /** Whether every eligible response body was read; false means the walk saw less than it looks like. */
    captureComplete: z.boolean(),
    /** The address the browser ended on, which a redirect may have changed. */
    finalUrl: z.string().min(1),
    /** Whether the client sent this page somewhere other than where it was asked to go. */
    redirected: z.boolean(),
    responseAccounting: atlasResponseAccountingSchema,
    statusCode: z.number().int().nullable(),
    /** The document title the page settled on. */
    title: z.string(),
    /** Why this declared page is not held, or `null` when it is. */
    unreachableBecause: z.string().min(1).nullable(),
  })
  .strict();

/** What the browser saw one declared page be. */
export type AtlasPageDetail = z.infer<typeof atlasPageDetailSchema>;

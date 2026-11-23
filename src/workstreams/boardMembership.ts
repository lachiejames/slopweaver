/**
 * How a board row is decided to sit under one of the owner's kept outcomes — carried on the candidate that proposes the
 * outcome and, once the owner keeps it, on the register tile it becomes.
 *
 * ## Why it lives with the candidates and the register
 *
 * The owner's outcomes have ONE source, the Workstreams register, and
 * the supervisor's coverage (`../supervisor/outcomes/coverage.ts`) reads them from it. So the rule that matches today's
 * board rows to an outcome travels with the outcome: proposed on a candidate, copied onto the tile a keep writes, read
 * back off the register. Nothing here is itself a list of outcomes.
 *
 * ## Two shapes, because the owner's outcomes are not all the same kind of thing
 *
 * Most name a SUBJECT — supabase, notion, the atlases — and match by what a row is about. One, _"all board rows from
 * the next 200 acted on and fully fixed"_, names a BAND of the ranked board and nothing else: it is about position, and
 * a keyword list pretending to express it would be a lie a reader could not see through.
 *
 * Pure: the schema and its type.
 */
import { z } from "zod";

/** A matcher: lowercase, trimmed, never empty — a blank one would match nothing and read as if it did. */
const matcherSchema = z
  .string()
  .min(1)
  .refine((value) => value === value.trim().toLowerCase(), "a matcher is lowercase with no surrounding space");

/** How a board row is decided to sit under an outcome, as a stored candidate or register entry carries it. */
export const boardMembershipSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("subject"),
    /**
     * Lowercase words or phrases tested against a row's id and label as whole words; any hit is a match
     * (`../supervisor/outcomes/coverage.ts` says why whole words rather than substrings).
     */
    matchers: z.array(matcherSchema).min(1),
    /**
     * The outcome is about the install's own bot, so each handle the profile declares for it
     * (`slackBot.selfHandles`) is a matcher too — the outcome itself names no bot.
     */
    namesTheBot: z.literal(true).optional(),
  }),
  z.strictObject({
    /** How many of the ranked rows sit under this outcome, counted from the top. */
    band: z.number().int().positive(),
    kind: z.literal("rank-band"),
  }),
]);

/** How a board row is decided to sit under an outcome: by subject, or by rank band. */
export type BoardMembership = z.infer<typeof boardMembershipSchema>;

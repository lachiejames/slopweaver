/**
 * The fields a `parked` journal line must carry to be written — the write schema `./rowEventSchema.ts` extends
 * its `parked` entry with, kept beside `./parkedEvent.ts`'s type and decoder rather than inside the register.
 *
 * `screenTail` alone may be empty — a blank screen is a reading, not a missing one — and it and every draft are
 * capped so one terminal or one message cannot make the journal unbounded. `question` is absent on a seat that
 * stopped between turns, and `drafts` on a seat that held none (or a line older than the field).
 */
import { z } from "zod";

import { PARK_DRAFT_MAX_CHARS, PARK_SCREEN_TAIL_MAX_CHARS } from "./parkedEvent.js";
import { isRepoSlug, isUtcInstant } from "./parkWake.js";

/** A non-empty string once trimmed — the register's own `words`. */
const words = z.string().trim().min(1);

/** One draft a checkpoint copies: the open question's drafted message, or a held Slack draft by its register id. */
const parkedDraftWire = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ask-action"), text: words.max(PARK_DRAFT_MAX_CHARS) }),
  z.object({ id: words, kind: z.literal("slack-draft"), text: words.max(PARK_DRAFT_MAX_CHARS) }),
]);

/** A wake, held to the same rules `handover park` parses its flags by (`./parkWake.ts`). */
const parkWakeWire = z.discriminatedUnion("kind", [
  z
    .object({
      atIso: z.string().refine((text) => isUtcInstant({ text }), "not one UTC instant ending in Z"),
      kind: z.literal("at"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("checks"),
      number: z.number().int().positive(),
      repo: z.string().refine((text) => isRepoSlug({ text }), "not owner/name"),
    })
    .strict(),
]);

/** Every field of a `parked` line beyond `atIso` and `kind`. */
export const PARKED_WIRE_FIELDS = {
  branch: words,
  drafts: z.array(parkedDraftWire).optional(),
  question: words.optional(),
  screenTail: z.string().max(PARK_SCREEN_TAIL_MAX_CHARS),
  sessionId: words,
  wake: parkWakeWire.optional(),
  workspaceRef: words,
  worktree: words,
};

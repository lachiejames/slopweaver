/**
 * Parsing one persisted resync record back into `./outcome.ts`'s shape.
 *
 * Its own module rather than a function inside the store because the parse is PURE and the store is not,
 * and this repository's unit lane can only test the pure half. A record that a hand edit or a half-written
 * file has left malformed is refused here rather than narrowed, so a reader never gets a `ResyncState`
 * whose fields it cannot trust.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";
import type { ResyncState } from "./outcome.js";

const blockerSchema = z.object({
  findingSlug: z.string().nullable(),
  key: z.string().min(1),
  reason: z.string(),
  steps: z.array(z.string()),
});

const demandSchema = z.object({
  author: z.string().nullable(),
  occurredAt: z.string().min(1),
  source: z.string().min(1),
  url: z.string().min(1),
});

const attemptSchema = z.object({
  afterClock: z.string().nullable(),
  asOfIso: z.string().min(1).optional(),
  beforeClock: z.string().nullable(),
  demand: demandSchema.optional(),
  exitCode: z.number().int(),
  finishedAtIso: z.string().min(1),
  outcome: z.enum(["succeeded", "failed"]),
  problems: z.array(z.string()),
  recipeId: z.string().min(1),
  relayCollision: z.string().min(1).optional(),
  signInWall: z.string().min(1).optional(),
  startedAtIso: z.string().min(1),
  stepDeferred: z.string().min(1).optional(),
});

const stateSchema = z.object({
  blocker: blockerSchema.nullable(),
  lastAttempt: attemptSchema.nullable(),
  lastSuccessAtIso: z.string().nullable(),
  recipeId: z.string().min(1),
});

/**
 * Where in a state record one schema issue sits. An issue about the record as a whole — not an object, say —
 * has an empty path, and that one is named `(root)` rather than printed as a bare colon.
 */
function stateIssueAt({ path }: { path: readonly PropertyKey[] }): string {
  const joined = path.join(".");
  return joined === "" ? "(root)" : joined;
}

/**
 * Read one already-decoded record.
 *
 * @param value the parsed JSON of one state file
 * @returns the state, or every reason it is not one
 */
export function parseResyncState({ value }: { readonly value: unknown }): Result<ResyncState> {
  const parsed = stateSchema.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${stateIssueAt({ path: issue.path })}: ${issue.message}`));
  }
  return ok(parsed.data);
}

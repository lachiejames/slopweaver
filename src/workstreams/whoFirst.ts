/**
 * Who a person says the FIRST conversation about a candidate is with, as people, kept apart from the team that owns
 * it — in `who-first.jsonl` beside the reactions ledger.
 *
 * Asked who to loop in on a workstream, the owner answers in two layers: the team that owns it, and the people the
 * first conversation is with. The mined `loopIn` is the miner's guess; this row is the owner's answer, which the page
 * shows over the guess and the next mine resolves into drafts.
 *
 * Pure. `./whoFirstStore.ts` is the effectful half.
 */
import { z } from "zod";

import { idSchema, REACTION_VIAS, textSchema } from "./candidates.js";

/** One who-first.jsonl row. */
export const whoFirstRowSchema = z
  .strictObject({
    bySession: textSchema,
    candidate: idSchema,
    iso: z.iso.datetime(),
    /** The candidate's mined name when the owner answered: what pins the id to one workstream across a re-mine. */
    name: textSchema,
    /** The people the first conversation is with, by name, as the owner said them. */
    people: z.array(textSchema),
    /** The team that owns it, in the owner's words, or `null` when none was named. */
    team: textSchema.nullable(),
    via: z.enum(REACTION_VIAS),
  })
  .refine((row) => row.people.length > 0 || row.team !== null, {
    message: "a who-first row names the people first, the owning team, or both",
    path: ["people"],
  });

/** One who-first.jsonl row. */
export type WhoFirstRow = z.infer<typeof whoFirstRowSchema>;

/** The owner's standing answer for one candidate: who first, which team owns it, and when it was said. */
export interface WhoFirst {
  readonly people: readonly string[];
  readonly team: string | null;
  readonly iso: string;
}

/**
 * Fold the ledger: the latest row per candidate stands.
 *
 * @param rows every who-first.jsonl row, in file order
 * @returns each answered candidate id and the owner's answer
 */
export function latestWhoFirst({ rows }: { rows: readonly WhoFirstRow[] }): ReadonlyMap<string, WhoFirst> {
  const standing = new Map<string, WhoFirst>();
  for (const row of rows) {
    standing.set(row.candidate, { iso: row.iso, people: row.people, team: row.team });
  }
  return standing;
}

/**
 * The names a `--people` value lists, split on commas and "and", each trimmed, blanks dropped.
 *
 * @param said e.g. `Jasper and Quinn` or `Jasper, Quinn`
 * @returns the names in the order the owner said them
 */
export function peopleFrom({ said }: { said: string }): readonly string[] {
  return said
    .split(/,|\band\b/u)
    .map((one) => one.trim())
    .filter((one) => one.length > 0);
}

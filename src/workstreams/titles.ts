/**
 * The title a person gives a mined candidate, kept in `titles.jsonl` beside the reactions ledger.
 *
 * A title states the outcome the owner wants, which a mined name may not. The mined name
 * stays the candidate's identity — it is what pins a reaction to one workstream across a re-mine — so a title is a
 * row of its own, and the register entry an accepted candidate becomes takes the title rather than the mined name.
 *
 * Pure. `./titleStore.ts` is the effectful half.
 */
import { z } from "zod";

import { idSchema, REACTION_VIAS, textSchema } from "./candidates.js";

/** One titles.jsonl row. */
export const titleRowSchema = z.strictObject({
  bySession: textSchema,
  candidate: idSchema,
  iso: z.iso.datetime(),
  /** The candidate's mined name when it was retitled: what pins the id to one workstream across a re-mine. */
  name: textSchema,
  title: textSchema,
  via: z.enum(REACTION_VIAS),
});

/** One titles.jsonl row. */
export type TitleRow = z.infer<typeof titleRowSchema>;

/**
 * Fold the ledger: the latest title per candidate stands.
 *
 * @param rows every titles.jsonl row, in file order
 * @returns each retitled candidate id and its title
 */
export function latestTitles({ rows }: { rows: readonly TitleRow[] }): ReadonlyMap<string, string> {
  const standing = new Map<string, string>();
  for (const row of rows) {
    standing.set(row.candidate, row.title);
  }
  return standing;
}

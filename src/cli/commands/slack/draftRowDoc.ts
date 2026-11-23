/**
 * The one board read `slack draft record --row` makes (`./draftRun.ts`): whether a handover doc, live or archived,
 * holds the slug. It reads the board and never the draft register, so it sits outside the verb's shell.
 */
import { join } from "node:path";

import { lookupDocBySlug } from "../../../handover/store.js";
import { stateHomePaths } from "../../../stateHome.js";

/**
 * The refusal for a `--row` no handover doc holds, live or archived — naming the file it looked for, so a typo
 * reads as one. A card filed under a row that is not there would join nothing and read its tags as partial.
 *
 * @param home the state home the board lives under
 * @param row the slug `--row` named, already shape-checked
 * @returns the refusal, or nothing when a doc holds the slug
 */
export function rowDocMissing({ home, row }: { home: string; row: string }): string | undefined {
  const handoverDir = stateHomePaths({ home }).handovers;
  if (lookupDocBySlug({ handoverDir, slug: row }) !== undefined) {
    return undefined;
  }
  return `slack draft record --row ${row}: no board row holds it — looked for ${join(handoverDir, `${row}.md`)} and its archive`;
}

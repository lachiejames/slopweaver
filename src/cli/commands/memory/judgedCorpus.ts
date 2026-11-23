/**
 * The one door every corpus-reading `memory` verb goes through before judging: resolve each amending memory's
 * board row onto its leaf, so `amends-canon-without-row` can see whether the row landed.
 *
 * The board reader is imported LAZILY and only when some leaf declares a row. Its static closure carries
 * `typescript` itself, and this module is reached by the PostToolUse hook, every `memory` verb and the state
 * repo's pre-push gate — a corpus declaring nothing pays nothing.
 */
import { declaredAmendsRows, withAmendsRowStates } from "../../../memory/amendsCanon.js";
import type { MemoryCorpus } from "../../../memory/types.js";

/**
 * The corpus with every declared amendment row's board state filled in.
 *
 * @param corpus the corpus as read
 * @param home the `$SLOPWEAVER_HOME` whose board is read; `undefined` for the ambient one
 * @returns the same corpus when nothing declares a row, else a resolved copy
 */
export async function resolveAmendsRows({
  corpus,
  home,
}: {
  corpus: MemoryCorpus;
  home: string | undefined;
}): Promise<MemoryCorpus> {
  if (declaredAmendsRows({ corpus }).length === 0) {
    return corpus;
  }
  const { boardRowStateResolver } = await import("./boardRowState.js");
  return withAmendsRowStates({ corpus, rowState: boardRowStateResolver({ home }) });
}

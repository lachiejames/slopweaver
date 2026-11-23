/**
 * The one row `handover row --json` prints: the board's own row shape for one doc, plus what a single row needs
 * that the whole board attests some other way. Split out of `./listJson.ts`, which is the board's document.
 */
import type { BoardModel } from "../../../handover/boardTypes.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { type BoardReferences, boardJsonRow } from "./listJson.js";
import { referenceContextOf } from "./referenceContext.js";

/**
 * ONE row as the exact text `handover row --json` prints — {@link boardJsonRow}, with the summary whole.
 *
 * The cap exists because the WHOLE board carried five half-megabyte summaries (§ The summary cap); a caller
 * that asked for one slug asked for that row's detail, and would otherwise get two sentences of a summary the
 * doc holds in full. The row's own authored
 * field is bounded by `MAX_DOC_BYTES` in `../../../handover/store.ts`, and the text still goes through
 * `safeJsonStringify`'s size guard.
 *
 * It also prints `repoLargestPull`, which the board does not: the largest pull-request number the row's `repo:`
 * checkout attests (`./repoPullScale.ts`). The console attests that scale from every address on the board; one row
 * has no board, and without it a bare pull-request number on a card built from one row never links.
 *
 * @param model the one doc's composed placement
 * @param references each doc `repo:` path's `origin` repository and the install's Linear context ({@link BoardReferences})
 * @param repoLargestPull the row's repository's largest attested pull-request number, when its checkout names one
 * @returns the JSON text to print
 */
export function boardRowJsonText({
  model,
  references,
  repoLargestPull,
}: {
  model: BoardModel;
  references: BoardReferences;
  repoLargestPull: number | undefined;
}): string {
  return safeJsonStringify({
    label: "handover row --json",
    value: {
      // One row has no board to fold its pull requests over: `prSteers` is absent, never "nobody else quoted the owner".
      ...boardJsonRow({
        model,
        ownerNames: references.ownerNames,
        prSteers: undefined,
        repoSlugs: references.repoSlugs,
      }),
      repoLargestPull,
      referenceContext: referenceContextOf(references),
      summary: model.doc.summary,
    },
  });
}

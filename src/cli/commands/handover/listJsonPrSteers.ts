/**
 * Every board row as the pull-request fold reads it (`../../../handover/prSteers.ts`). Split out of `./listJson.ts`,
 * which is the board's document: `handover currency` folds the same rows, and reads nothing else of that file.
 */
import type { BoardModel } from "../../../handover/boardTypes.js";
import { heldHisWordsOf, type PrSteerRow } from "../../../handover/prSteers.js";
import { publishedWaitOf } from "./listJsonWait.js";

/**
 * Every board row as the pull-request fold reads it: its references are read from its summary, the question it
 * publishes, its placement reason, its evidence and its own stored quotes — the strings a seat writes a pull request
 * into. `handover list --json` and `handover currency` both fold these, so a card's steers and the verdict leading it
 * name the same pull requests.
 *
 * @param models every doc's composed placement, in board order
 * @param repoSlugs each doc `repo:` path's `origin` repository, which alone lets a bare `#N` name a pull request
 * @returns the rows, in board order
 */
export function boardPrSteerRows({
  models,
  repoSlugs,
}: {
  models: readonly BoardModel[];
  repoSlugs: ReadonlyMap<string, string>;
}): readonly PrSteerRow[] {
  return models.map((model) => prSteerRowOf({ model, repoSlugs }));
}

/**
 * One board row as the pull-request fold reads it ({@link boardPrSteerRows}).
 *
 * @param model the doc's composed placement
 * @param repoSlugs each doc `repo:` path's `origin` repository
 * @returns the row
 */
export function prSteerRowOf({
  model,
  repoSlugs,
}: {
  model: BoardModel;
  repoSlugs: ReadonlyMap<string, string>;
}): PrSteerRow {
  const quotes = heldHisWordsOf({ doc: model.doc });
  const texts: string[] = [...model.doc.evidence, ...quotes.map((quote) => quote.words)];
  for (const part of [model.doc.summary, publishedWaitOf({ model }).question, model.reason]) {
    if (part !== undefined) {
      texts.push(part);
    }
  }
  return {
    quotes,
    repoSlug: model.doc.repo === undefined ? undefined : repoSlugs.get(model.doc.repo),
    slug: model.doc.slug,
    texts,
  };
}

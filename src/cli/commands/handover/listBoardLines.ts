/**
 * The rendered half of `handover list`: the board, its collision and stale-repository lines, and the
 * stuck-dependency footnote. Apart from `./run.ts` along the seam the verb already draws — everything here reads
 * the LIVE docs' working trees, so it is the half that can block, and the verb writes its caveats before calling it.
 */

import { readFileSync } from "node:fs";

import { isClosedBoardSection } from "../../../handover/boardRefusal.js";
import { type BoardModel } from "../../../handover/boardTypes.js";
import { claimOf, collisionsAmong, type DocClaim } from "../../../handover/collide.js";
import { type HandoverDoc } from "../../../handover/doc.js";
import { commitsBehindUpstream } from "../../../handover/evaluate.js";
import { renderBoard } from "../../../handover/render.js";
import { matchesTagFilter, type TagFilter } from "../../../handover/tagFilter.js";
import { stuckBlockerLines, tagFilterSummaryLines } from "./listPresentation.js";

/**
 * How far behind its upstream each distinct repository is.
 *
 * Keyed by REPO, not by doc, so a board with a dozen docs in one tree costs one git call rather than twelve.
 *
 * @param docs the docs to collect repositories from
 * @returns commits-behind per repository, including zeros
 */
function staleRepos({ docs }: { docs: readonly HandoverDoc[] }): ReadonlyMap<string, number> {
  const behind = new Map<string, number>();
  const roots = new Set(docs.map((doc) => doc.repo).filter((root): root is string => root !== undefined));
  for (const root of roots) {
    behind.set(root, commitsBehindUpstream({ repo: root }));
  }
  return behind;
}

/**
 * The file claims of each doc, read from disk.
 *
 * A second read of each doc, which is worth stating: `scanBoard` already read them and discarded the text. The
 * duplication buys the collision warning without changing the scan's shape, and it is bounded to LIVE docs — a
 * finished doc's overlap with a running one is noise.
 *
 * @param docs the live docs
 * @returns one claim per doc whose text could be read
 */
function claimsOf({ docs }: { docs: readonly HandoverDoc[] }): readonly DocClaim[] {
  const claims: DocClaim[] = [];
  for (const doc of docs) {
    try {
      claims.push(claimOf({ doc, text: readFileSync(doc.path, "utf8") }));
    } catch {
      // Unreadable here is already reported by the scan; a missing claim only weakens the warning.
    }
  }
  return claims;
}

/**
 * The board itself and the stuck-dependency footnote under it, in the order they are written.
 *
 * Everything here depends on the LIVE set, and the collision warning reads each of those docs off disk, so
 * this is the half that can block. Keeping it behind one function means the caller can write the caveats
 * first without a reader having to notice that it matters.
 *
 * @param models every doc's composed placement
 * @param showAll whether the computed closed sections are included
 * @param filter the `--tag` filter: it narrows the rows printed and the collision and stale-repository lines about
 *   them, never the board-wide facts
 * @param liveDocs the docs the scan read out of `handovers/` — the only ones the collision and stale-repository
 *   checks describe, so a doc recovered from the archive can never raise a live collision
 * @returns the lines, top to bottom
 */
export function boardAndFootnoteLines({
  filter,
  liveDocs,
  models,
  showAll,
  unreadable,
}: {
  filter: TagFilter;
  liveDocs: readonly HandoverDoc[];
  models: readonly BoardModel[];
  showAll: boolean;
  unreadable: readonly string[];
}): readonly string[] {
  const onBoard = new Set(liveDocs);
  const liveModels = models.filter((model) => !isClosedBoardSection({ section: model.section }));
  const live = liveModels
    .filter((model) => onBoard.has(model.doc) && matchesTagFilter({ filter, tags: model.tags }))
    .map((model) => model.doc);
  return [
    ...tagFilterSummaryLines({ filter, population: showAll ? models : liveModels }),
    ...renderBoard({
      collisions: collisionsAmong({ claims: claimsOf({ docs: live }) }),
      filter,
      models,
      showAll,
      staleRepos: staleRepos({ docs: live }),
      unreadable,
    }),
    ...stuckBlockerLines({ models }),
  ];
}

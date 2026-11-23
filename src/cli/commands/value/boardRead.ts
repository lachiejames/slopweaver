/**
 * The board's rows, composed exactly as `handover list --json` composes them, for the value sample to draw from.
 * The effectful edge only: the draw itself is pure (`../../../value/sample.ts`).
 *
 * Probe commands are not run (`runCommands: false`), as `talk pack`'s asks read does not run them
 * (`../talk/packAsksRead.ts`): a sample reads how asks ENDED, which the journals and front matter carry, and never
 * waits on a probe sweep to say so.
 *
 * Its stated blind spot: a row swept into the archive within the week is not on the board and is not drawn.
 */
import { originRepositoryOf } from "../../../config.js";
import { archivedDependencies, journalEvidence } from "../../../handover/assemble.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import { scanBoard } from "../../../handover/store.js";
import { EMPTY_TAG_FILTER } from "../../../handover/tagFilter.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import type { BoardAskRow } from "../../../value/sample.js";
import { repositorySlugs } from "../handover/boardReferences.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { boardJsonDocument, NO_BOARD_REFERENCES, NO_DETACHED_FINDINGS } from "../handover/listJson.js";
import { deadlineIn, probeStates } from "../handover/probeSweep.js";

/** The probe sweep's budget, the same default `handover list` runs under. */
const BOARD_DEADLINE_SECONDS = 60;

/**
 * Every board row's ask fields.
 *
 * @param home the state home the board and journals live under
 * @returns the rows, or why the board would not scan
 */
export function readBoardAskRows({ home }: { home: string }): Result<readonly BoardAskRow[]> {
  const handoverDir = resolveHandoverDir({ dir: undefined, home });
  const scanStartedIso = new Date().toISOString();
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    return err([`the board would not scan: ${scan.error.message}`]);
  }
  const { docs, unreadable } = scan.value;
  const sweep = probeStates({
    base: undefined,
    deadline: deadlineIn({ seconds: BOARD_DEADLINE_SECONDS }),
    docs,
    runCommands: false,
  });
  const models = composeBoardModels({
    journals: journalEvidence({ docs, runsDir: stateHomePaths({ home }).runs }),
    probeStates: sweep.states,
    resolutionDocs: [...docs, ...archivedDependencies({ docs, handoverDir })],
    roots: docs,
  });
  const repoSlugs = repositorySlugs({
    now: Date.now,
    paths: docs.flatMap((doc) => (doc.repo === undefined ? [] : [doc.repo])),
    resolve: originRepositoryOf,
  });
  const board = boardJsonDocument({
    detached: NO_DETACHED_FINDINGS,
    filter: EMPTY_TAG_FILTER,
    handoverDir,
    models,
    observedAtIso: new Date().toISOString(),
    references: { ...NO_BOARD_REFERENCES, repoSlugs },
    scanStartedIso,
    unreadable,
    unresolved: sweep.unresolved,
  });
  return ok(
    board.rows.map((row) => ({
      artifact: row.artifact,
      kind: row.kind,
      prUrls: row.prUrls,
      settledIso: row.settledIso,
      settlement: row.settlement,
      settlementWitness: row.settlementWitness,
      slug: row.slug,
      summary: row.summary,
    })),
  );
}

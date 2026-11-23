/**
 * The one board read `sweep apply` and `sweep board` share.
 *
 * Extracted rather than duplicated because the two verbs must agree about what a row IS: a session that acts
 * on a slug it just saw classified would otherwise be acting on a second opinion computed by a second reader.
 * `command:` probes are deliberately NOT run here — `sweep apply` re-derives the verdict to find the
 * candidate, and re-running a row's shell commands as a side effect of acting on it is a surprise the caller
 * did not ask for. A `SHIPPED` verdict that needed a command probe is one `sweep board --probe` established
 * and the operator then named.
 *
 * The one read it DOES make outside the board is GitHub's, for `PR_ENDED` (`./endedRead.ts`): a read, never a
 * command, so `sweep apply` re-derives that verdict exactly as `sweep board` printed it. A caller passing no
 * fetch reads no pull request, and no row reads `PR_ENDED`.
 */
import { resolve } from "node:path";

import { archivedDependencies, type JournalEvidence, journalEvidence } from "../../../handover/assemble.js";
import { isClosedBoardSection } from "../../../handover/boardRefusal.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import type { BoardModel } from "../../../handover/boardTypes.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { scanBoard } from "../../../handover/store.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FetchPrClosure, PrClosure } from "../../../live/github/prClosure.js";
import { stateHomePaths } from "../../../stateHome.js";
import { classifyBoard, type SweepCandidate } from "../../../sweep/classify.js";
import { type SweepError, SweepErrors } from "../../../sweep/errors.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { probeStates } from "../handover/probeSweep.js";

import { readEndedPullRequests } from "./endedRead.js";
import { boardSupersessions } from "./rowTexts.js";

/** The live board and every read it was composed over. */
export interface LiveBoard {
  readonly archived: readonly HandoverDoc[];
  readonly docs: readonly HandoverDoc[];
  readonly handoverDir: string;
  readonly journals: ReadonlyMap<string, JournalEvidence>;
  readonly live: readonly BoardModel[];
  readonly unreadable: readonly string[];
}

/**
 * Compose the live board once, without running any `command:` probe, so every sweep verb reads the same rows.
 *
 * @param home the state home
 * @param dir an explicit handovers directory, when the caller named one
 * @returns the live rows and the reads behind them, or the scan's failure
 */
export function readLiveBoard({ home, dir }: { home: string; dir: string | undefined }): Result<LiveBoard, SweepError> {
  const handoverDir = resolveHandoverDir({ dir, home });
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    return err(SweepErrors.rowFile({ cause: scan.error.message, path: handoverDir }));
  }
  const { docs, unreadable } = scan.value;
  const journals = journalEvidence({ docs, runsDir: stateHomePaths({ home }).runs });
  const archived = archivedDependencies({ docs, handoverDir });
  const models = composeBoardModels({
    journals,
    probeStates: probeStates({ base: undefined, docs, runCommands: false }).states,
    resolutionDocs: [...docs, ...archived],
    roots: docs,
  });
  const live = models.filter((model) => !isClosedBoardSection({ section: model.section }));
  return ok({ archived, docs, handoverDir, journals, live, unreadable });
}

/**
 * Classify every live board row, without running any `command:` probe.
 *
 * @param home the state home
 * @param dir an explicit handovers directory, when the caller named one
 * @param fetch the pull-request closure read `PR_ENDED` needs, or undefined to read none
 * @param writeDiagnostic where a failed pull-request read is printed
 * @returns one candidate per live row, or the scan's failure
 */
export async function sweepCandidates({
  home,
  dir,
  fetch,
  writeDiagnostic,
}: {
  home: string;
  dir: string | undefined;
  fetch: FetchPrClosure | undefined;
  writeDiagnostic: (line: string) => void;
}): Promise<Result<readonly SweepCandidate[], SweepError>> {
  const board = readLiveBoard({ dir, home });
  if (board.isErr()) {
    return err(board.error);
  }
  const { docs, handoverDir, journals, live } = board.value;
  const supersessions = boardSupersessions({ docs, handoverDir, journals, live });
  let closures: ReadonlyMap<string, PrClosure> = new Map();
  if (fetch !== undefined) {
    const ended = await readEndedPullRequests({ fetch, models: live });
    ended.unread.forEach((line) => {
      writeDiagnostic(`sweep: could not read ${line} — its row keeps the verdict the board alone gives it`);
    });
    closures = ended.closures;
  }
  return ok(
    classifyBoard({
      board: { handoverDir: resolve(handoverDir), home: resolve(home) },
      closures,
      models: live,
      supersessions: supersessions.edges,
    }),
  );
}

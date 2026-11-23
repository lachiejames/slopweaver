/**
 * `talk pack`'s asks half and the proof verdicts it leads with — the board composed the way `handover list --json`
 * composes it, then the rows the board says are the owner's.
 *
 * Split out of {@link ./packRun.js} (the file-size ratchet) along that seam: composing the board is the slow
 * read the pack exists to keep off a call, and it is the one half that touches the handover scan, the run
 * journals and the probe sweep, where every other half reads one source.
 */
import { readFileSync } from "node:fs";

import { originRepositoryOf } from "../../../config.js";
import { archivedDependencies, journalEvidence } from "../../../handover/assemble.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import { parseHandoverDoc } from "../../../handover/doc.js";
import { scanBoard } from "../../../handover/store.js";
import { EMPTY_TAG_FILTER } from "../../../handover/tagFilter.js";
import { lastReading } from "../../../readings/store.js";
import { stateHomePaths } from "../../../stateHome.js";
import { BOARD_ROW_MAX_BYTES, boardRowForVoice } from "../../../talk/boardRow.js";
import type { PackUnread, TalkContextPack } from "../../../talk/contextPack.js";
import { packAsksOf, skippedDocsUnread } from "../../../talk/packAsks.js";
import { type PackProofSource, packProofSourceOf } from "../../../talk/packProofs.js";
import { repositorySlugs } from "../handover/boardReferences.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { boardJsonDocument, NO_BOARD_REFERENCES, NO_DETACHED_FINDINGS } from "../handover/listJson.js";
import { deadlineIn, probeStates } from "../handover/probeSweep.js";

/** The probe sweep's budget, the same default `handover list` runs under. */
const BOARD_DEADLINE_SECONDS = 60;

/**
 * The owner's words behind one row, read off its doc as `board_row` reads them and bounded as it bounds them. The journal is
 * passed EMPTY on purpose: the pack keeps the owner's words alone, and an empty journal adds nothing a cut could take them
 * for.
 *
 * @param path the row's doc
 * @returns the words, or `undefined` when the doc could not be read
 */
function docOwnerWords({ path }: { path: string }): readonly string[] | undefined {
  try {
    const text = readFileSync(path, "utf8");
    const doc = parseHandoverDoc({ path, text });
    const journal = { events: [], unreadableLines: [] };
    return boardRowForVoice({ doc, journal, maxBytes: BOARD_ROW_MAX_BYTES, text }).ownerWords;
  } catch {
    return undefined;
  }
}

/**
 * The asks half: the board composed exactly as `handover list --json` composes it, then its rows the
 * board says are the owner's.
 *
 * @param home the state home the journals live under
 * @param dir the board directory, when `--dir` named one
 * @param proofs the last recorded proof verdicts ({@link readProofs})
 * @returns the asks, when the board was composed, any docs it skipped and each row's tags as `key:value`, or why it
 *   could not be read
 */
export function readAsks({ home, dir, proofs }: { home: string; dir: string | undefined; proofs: PackProofSource }):
  | {
      asks: TalkContextPack["asks"];
      rows: ReturnType<typeof boardJsonDocument>["rows"];
      observedIso: string;
      skipped: PackUnread | undefined;
      tagsBySlug: ReadonlyMap<string, readonly string[]>;
    }
  | PackUnread {
  const handoverDir = resolveHandoverDir({ dir, home });
  const scanStartedIso = new Date().toISOString();
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    return { section: "asks", why: scan.error.message };
  }
  const { docs, unreadable } = scan.value;
  const journals = journalEvidence({ docs, runsDir: stateHomePaths({ home }).runs });
  const sweep = probeStates({
    base: undefined,
    deadline: deadlineIn({ seconds: BOARD_DEADLINE_SECONDS }),
    docs,
    runCommands: false,
  });
  const models = composeBoardModels({
    journals,
    probeStates: sweep.states,
    resolutionDocs: [...docs, ...archivedDependencies({ docs, handoverDir })],
    roots: docs,
  });
  const observedIso = new Date().toISOString();
  // The repositories are read so a row naming a repository's pull request by number joins the row linking it; Linear and records are not.
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
    observedAtIso: observedIso,
    references: { ...NO_BOARD_REFERENCES, repoSlugs },
    scanStartedIso,
    unreadable,
    unresolved: sweep.unresolved,
  });
  const asks = packAsksOf({ ownerWordsOf: docOwnerWords, proofs, rows: board.rows });
  const tagsBySlug = new Map(board.rows.map((row) => [row.slug, row.tags.map((tag) => `${tag.key}:${tag.value}`)]));
  return { asks, observedIso, rows: board.rows, skipped: skippedDocsUnread({ names: unreadable }), tagsBySlug };
}

/**
 * The proof verdicts the asks lead with, off the last recorded `handover currency` reading — never a GitHub read.
 *
 * @param home the state home the readings ledger lives under
 * @returns the verdicts, or why none could be read
 */
export function readProofs({ home }: { home: string }): PackProofSource {
  const reading = lastReading({ home, producer: "handover currency" });
  if (reading.isErr()) {
    return { kind: "unread", why: `no handover currency reading could be read: ${reading.error.message}` };
  }
  return packProofSourceOf({ document: reading.value.document });
}

/**
 * Reading and writing one ask's CHECKPOINT SET — the effectful half of `./checkpoint.ts`, whose header
 * carries the measured turn this exists for.
 *
 * The set has two halves and they live in two places, on purpose rather than for want of tidying:
 *
 * - `live/slack/checkpoints/<key>/` holds the DRAFTS. A draft is written here the moment
 *   `turn resume --answer` accepts one, because that is the single gate every worker must pass and the only
 *   moment the bytes are known-good. Content-addressed (`draft-<digest>.json`) so the same draft re-validated
 *   writes the same file, and ordered by an append-only `log.jsonl` so a reader never has to infer a sequence
 *   from an mtime a copy would destroy.
 * - `live/slack/reviews/<key>/` holds the VERDICTS, already, written as each round produces one by
 *   `./reviewStore.ts`. Nothing is duplicated into the checkpoint directory; what this module adds there is
 *   the enumeration that never existed.
 *
 * ## Why a failed checkpoint write must not fail the validate
 *
 * `writeDraftCheckpoint` is called from the middle of `turn resume --answer`, whose actual job is to tell a
 * worker whether its answer is sound. A checkpoint is insurance against a session dying later; refusing a
 * valid answer because the insurance could not be filed would turn a disk hiccup into the very outcome this
 * module exists to prevent. So it answers a `Result` and its caller states the failure without blocking on
 * it.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { readReviewVerdict } from "../../admit/reviewVerdictFile.js";
import { appendLines } from "../../lib/appendSeparator.js";
import { logger } from "../../lib/logger.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import type { AskIdentity } from "../ask/identity.js";
import {
  CHECKPOINT_LOG_FILE,
  type CheckpointRoundVerdict,
  type CheckpointSet,
  checkpointRounds,
  type DraftCheckpoint,
  parseDraftRow,
  resumingFromCheckpointDetail,
} from "./checkpoint.js";
import { currentGenerationDispatchRecord } from "./dispatchStore.js";
import { readReviewRecord, reviewPaths } from "./reviewStore.js";

/**
 * What a caught `unknown` says for itself, so the one log line this module writes carries the real reason
 * rather than a stand-in.
 *
 * @param error the caught value
 * @returns its message, or its own string form
 */
function errorText({ error }: { error: unknown }): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** The log row layout version. Bump only alongside a reader that understands both. */
const CHECKPOINT_LOG_SCHEMA_VERSION = 1;

/**
 * Where one ask's drafts live.
 *
 * @param askIdentity the exact ask
 * @param home the resolved state home
 * @returns the absolute checkpoint directory, keyed exactly as `dispatches/` and `reviews/` are
 */
export function checkpointDir({ askIdentity, home }: { askIdentity: AskIdentity; home: string }): string {
  return join(stateHomePaths({ home }).live.slack.checkpoints, `${askIdentity.channel}-${askIdentity.messageTs}`);
}

/**
 * The basename one draft's bytes are stored under — its own digest, so re-validating an unchanged draft
 * rewrites the same file with the same contents instead of growing the directory.
 *
 * @param digest the `sha256:<hex>` digest of the draft
 * @returns the basename
 */
export function draftFileName({ digest }: { digest: string }): string {
  return `draft-${digest.replace(/[^A-Za-z0-9]+/gu, "-")}.json`;
}

/**
 * Record one validated draft into the ask's record set: the bytes, then the log row that orders them.
 *
 * The bytes FIRST. A log row naming a file that is not there yet is the same boot-versus-delivery race
 * `./reviewStore.ts`'s `writeReview` orders around, and a reader that trusts the log would report a draft it
 * cannot open.
 *
 * The draft is stored as the worker's own TEXT rather than as a re-serialised object. What a later session
 * has to be able to do is hand the file straight back to `turn resume --answer` and get the same digest, and
 * a re-serialisation that reorders one key breaks exactly that.
 *
 * @param answerText the draft's bytes, exactly as the worker wrote them
 * @param askIdentity the exact ask
 * @param atIso when validate accepted it
 * @param digest the `sha256:<hex>` digest the review round will bind to
 * @param dispatchId the dispatch this draft was written under
 * @param home the resolved state home
 * @param leaseExpiresAt the generation token a later session compares itself against
 * @returns the absolute path written, or `undefined` when it could not be
 */
export function writeDraftCheckpoint({
  answerText,
  askIdentity,
  atIso,
  digest,
  dispatchId,
  home,
  leaseExpiresAt,
}: {
  answerText: string;
  askIdentity: AskIdentity;
  atIso: string;
  digest: string;
  dispatchId: string;
  home: string;
  leaseExpiresAt: string;
}): string | undefined {
  const dir = checkpointDir({ askIdentity, home });
  const file = draftFileName({ digest });
  try {
    mkdirSync(dir, { recursive: true });
    writeFileAtomic({ contents: answerText, path: join(dir, file) });
    appendLines({
      path: join(dir, CHECKPOINT_LOG_FILE),
      text: `${JSON.stringify({
        answerDigest: digest,
        dispatchId,
        draftFile: file,
        leaseExpiresAt,
        recordedAtIso: atIso,
        schemaVersion: CHECKPOINT_LOG_SCHEMA_VERSION,
      })}\n`,
    });
  } catch (error) {
    logger.error({
      msg: `could not checkpoint this draft into the ask's record set: ${errorText({ error })}`,
    });
    return undefined;
  }
  return join(dir, file);
}

/**
 * Every draft one ask checkpointed, oldest first, read back off its own log.
 *
 * A row whose file is no longer on disk is DROPPED rather than reported: the block a fresh session reads
 * names a path it is told to open, and naming one that is not there is the failure this whole module exists
 * to stop repeating. An unparseable row is dropped for the same reason — an append-only log written by more
 * than one process has malformed lines as an ordinary state, not an error.
 *
 * @param askIdentity the exact ask
 * @param home the resolved state home
 * @returns the drafts, oldest first
 */
export function readDraftCheckpoints({
  askIdentity,
  home,
}: {
  askIdentity: AskIdentity;
  home: string;
}): readonly DraftCheckpoint[] {
  const dir = checkpointDir({ askIdentity, home });
  const log = join(dir, CHECKPOINT_LOG_FILE);
  if (!existsSync(log)) {
    return [];
  }
  let text = "";
  try {
    text = readFileSync(log, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => parseDraftRow({ line }))
    .filter((row): row is DraftCheckpoint => row !== undefined)
    .filter((row) => existsSync(join(dir, row.draftFile)));
}

/**
 * Every review round one ask spent, oldest first, each with its verdict already read off disk.
 *
 * The ordering is `./checkpoint.ts`'s `checkpointRounds`, which is pure over the directory's entry names; the
 * only thing done here is opening each file. A round whose verdict will not parse is KEPT with an
 * `undefined` verdict rather than dropped, because "there was a round here and its finding is unreadable" is
 * a different instruction to a fresh session than "there was no round".
 *
 * @param askIdentity the exact ask
 * @param home the resolved state home
 * @returns the rounds, oldest first
 * @internal
 */
export function readCheckpointRounds({
  askIdentity,
  home,
}: {
  askIdentity: AskIdentity;
  home: string;
}): readonly CheckpointRoundVerdict[] {
  const paths = reviewPaths({ askIdentity, home });
  if (!existsSync(paths.dir)) {
    return [];
  }
  let entries: readonly string[] = [];
  try {
    entries = readdirSync(paths.dir);
  } catch {
    return [];
  }
  const record = readReviewRecord({ askIdentity, home });
  const standing =
    record === undefined ? undefined : { reviewer: record.reviewer.workspaceId, spawnedAt: record.spawnedAt };
  return checkpointRounds({ entries, standing }).map((round) => {
    const verdict = readReviewVerdict({ path: join(paths.dir, round.file) });
    return { round, verdict: verdict.isOk() ? verdict.value : undefined };
  });
}

/**
 * Everything one ask's record set can still prove about a turn that did not finish.
 *
 * @param askIdentity the exact ask
 * @param home the resolved state home
 * @returns the drafts and the rounds, each oldest first
 */
export function readCheckpointSet({ askIdentity, home }: { askIdentity: AskIdentity; home: string }): CheckpointSet {
  return {
    drafts: readDraftCheckpoints({ askIdentity, home }),
    rounds: readCheckpointRounds({ askIdentity, home }),
  };
}

/**
 * The card's resuming sentence for one ask, or `undefined` when this turn is not inheriting anything — the
 * effectful shape `budgetWarned` (`../../cli/commands/turn/dispatchBudget.ts`) already established, so a card
 * writer asks one question and gets a line or nothing.
 *
 * Both halves of the decision are durable facts: the current dispatch record's own lease, and the lease each
 * checkpointed draft was written under. No clock is read and no screen is scraped, so the line cannot age
 * into a lie the way the mechanical `now:` line it replaces did.
 *
 * @param askIdentity the exact ask
 * @param home the resolved state home
 * @returns the sentence to show on the running step, or `undefined`
 */
export function checkpointCardLine({
  askIdentity,
  home,
}: {
  askIdentity: AskIdentity;
  home: string;
}): string | undefined {
  const record = currentGenerationDispatchRecord({ askIdentity, home });
  if (record === undefined) {
    return undefined;
  }
  return resumingFromCheckpointDetail({
    currentLease: record.leaseExpiresAt,
    set: readCheckpointSet({ askIdentity, home }),
  });
}

/**
 * Checkpoint a draft and say so, without ever failing the validate that called it — see this module's
 * header for why that separation is the rule rather than a convenience.
 *
 * @param answerText the draft's bytes, exactly as the worker wrote them
 * @param askIdentity the exact ask
 * @param atIso when validate accepted it
 * @param digest the `sha256:<hex>` digest the review round will bind to
 * @param dispatchId the dispatch this draft was written under
 * @param home the resolved state home
 * @param leaseExpiresAt the generation token a later session compares itself against
 */
export function checkpointDraftBestEffort({
  answerText,
  askIdentity,
  atIso,
  digest,
  dispatchId,
  home,
  leaseExpiresAt,
}: {
  answerText: string;
  askIdentity: AskIdentity;
  atIso: string;
  digest: string;
  dispatchId: string;
  home: string;
  leaseExpiresAt: string;
}): void {
  const written = writeDraftCheckpoint({ answerText, askIdentity, atIso, digest, dispatchId, home, leaseExpiresAt });
  if (written === undefined) {
    return;
  }
  logger.out({ line: `checkpointed this draft to ${written} — a session that dies now does not lose it` });
}

/**
 * The Slack leg's two streaming passes over bronze (`./slackRead.ts` has why there are exactly two), and the one
 * file scan every Slack bronze reader shares.
 *
 * Both passes are synchronous, so no timer can interrupt them: under `session-start --deadline` they ask a
 * `stopWhen` between chunks instead, and a pass it stops reports itself cut rather than handing back half a scan.
 */
import { readJsonlLines } from "../../../corpus/corpusStore.js";
import type { IngestError } from "../../../lib/ingestError.js";
import { safeFs } from "../../../lib/safeBoundary.js";
import type { SlackRow } from "./slackRow.js";
import { isLaterThan, slackRowOf, tagsOwner, threadKeyOf, unreadableWord } from "./slackRow.js";
import { joinBroadcastReactors, recordThreadLine, type ThreadFacts } from "./slackThreadFacts.js";

/**
 * A chunk-boundary check for a synchronous scan, which no timer can interrupt: `onChunk` stops the read once
 * `stopWhen` answers true, and `stopped` says whether it did.
 *
 * @param stopWhen asked before each chunk; absent, the scan reads to the end
 * @returns the reader's `onChunk`, and whether it stopped a read
 */
function chunkGuard({ stopWhen }: { stopWhen: (() => boolean) | undefined }): {
  onChunk: () => boolean;
  stopped: () => boolean;
} {
  let stopped = false;
  return {
    onChunk: () => {
      stopped = stopped || stopWhen?.() === true;
      return !stopped;
    },
    stopped: () => stopped,
  };
}

/**
 * Stream one file, handing every line to a consumer.
 *
 * @param path the bronze file to read
 * @param onLine what to do with each line
 * @param onChunk asked before each chunk; `false` stops the read there
 * @returns the typed fs error when the file could not be read, undefined when it was
 */
export function scanFile({
  path,
  onLine,
  onChunk,
}: {
  path: string;
  onLine: (args: { line: string }) => void;
  onChunk?: () => boolean;
}): IngestError | undefined {
  const read = safeFs({
    execute: () => {
      readJsonlLines({ onLine, path, ...(onChunk === undefined ? {} : { onChunk }) });
    },
    operation: "scanSlackBronze",
    path,
  });
  return read.isErr() ? read.error : undefined;
}

/**
 * Scan every file in order through one chunk guard, stopping at the first that cannot be read or once the guard
 * stops a read.
 *
 * @param paths the bronze files to scan
 * @param onLine what to do with each line
 * @param stopWhen asked between chunks
 * @returns undefined when every file was read whole, the typed reason one was not, or that the scan was cut
 */
function scanAll({
  paths,
  onLine,
  stopWhen,
}: {
  paths: readonly string[];
  onLine: (args: { line: string }) => void;
  stopWhen: (() => boolean) | undefined;
}): { refusal: IngestError } | { cut: true } | undefined {
  const guard = chunkGuard({ stopWhen });
  for (const path of paths) {
    const failed = scanFile({ onChunk: guard.onChunk, onLine, path });
    if (failed !== undefined) {
      return { refusal: failed };
    }
    if (guard.stopped()) {
      return { cut: true };
    }
  }
  return undefined;
}

/**
 * What pass one established: the threads the owner spoke in, and the threads somebody tagged the owner in.
 *
 * @internal the contract between the scan and the two detectors it feeds.
 */
export interface OwnerTouchedThreads {
  /** The owner's latest message per thread the owner SPOKE in, inside the window. Feeds the thread-movement detector. */
  readonly spoken: ReadonlyMap<string, SlackRow>;
  /** The LATEST message tagging the owner per thread, inside the window. Feeds the mention detector. */
  readonly tagged: ReadonlyMap<string, SlackRow>;
  /** Lines carrying the owner's id that did not parse as a message — each may be a message of the owner's this read lost. */
  readonly unparsed: number;
}

/**
 * Keep `row` in `held` under `key` when it is later than what is already there.
 *
 * @param held the map being folded
 * @param key the row's thread
 * @param row the candidate
 */
function keepLatest({ held, key, row }: { held: Map<string, SlackRow>; key: string; row: SlackRow }): void {
  const current = held.get(key);
  if (current === undefined || isLaterThan({ candidate: row, held: current })) {
    held.set(key, row);
  }
}

/**
 * Pass one: every thread the owner SPOKE in and every thread the owner was TAGGED in, inside the window.
 *
 * The `includes` check is what makes a multi-gigabyte scan affordable — a line that does not carry the owner's id at all is
 * dropped before anything parses it, and that is the overwhelming majority of them. **A line carrying a `\u`
 * escape is never dropped by it**, because JSON may spell the owner's id, or the mention of it, in escapes the raw text
 * does not match; such a line is parsed whole and judged on its decoded fields. `./slackRow.ts`'s `fastSourceId` measures
 * how few lines that is.
 *
 * **The mention half rides that same gate and therefore costs nothing.** A message tagging the owner carries
 * `<@ownerId>`, so it already passes the prefilter a scan for the owner's own messages had to run anyway; folding
 * it in here is what keeps a second detector from buying a third pass over several gigabytes.
 *
 * Both halves are bounded by `sinceIso` — the mention branch as explicitly as the spoken one, because the
 * compacted window is the WHOLE history and an unbounded map over it is the one shape this function cannot
 * afford.
 *
 * @param paths the bronze files to scan
 * @param ownerId the owner's own Slack id
 * @param sinceIso the oldest message that still counts
 * @param stopWhen asked between chunks; once it answers true the scan stops and reports itself cut
 * @returns both sets, the typed reason a file could not be read, or that the scan was cut
 */
export function spokenInThreads({
  paths,
  ownerId,
  sinceIso,
  stopWhen,
}: {
  paths: readonly string[];
  ownerId: string;
  sinceIso: string;
  stopWhen: (() => boolean) | undefined;
}): OwnerTouchedThreads | { refusal: IngestError } | { cut: true } {
  const spoken = new Map<string, SlackRow>();
  const tagged = new Map<string, SlackRow>();
  let unparsed = 0;
  const stopped = scanAll({
    onLine: ({ line }) => {
      if (!line.includes(ownerId) && !line.includes("\\u")) {
        return;
      }
      const row = slackRowOf({ line });
      if (row === undefined) {
        unparsed += Number(unreadableWord({ keys: undefined, line }));
        return;
      }
      if (row.tsIso < sinceIso) {
        return;
      }
      const key = threadKeyOf({ sourceId: row.sourceId });
      if (key === undefined) {
        // The owner's own word, or one tagging the owner, that names no thread is a message this read lost, not one it
        // has no use for.
        unparsed += Number(row.author === ownerId || tagsOwner({ ownerId, row }));
        return;
      }
      if (row.author === ownerId) {
        keepLatest({ held: spoken, key, row });
      } else if (tagsOwner({ ownerId, row })) {
        keepLatest({ held: tagged, key, row });
      }
    },
    paths,
    stopWhen,
  });
  if (stopped !== undefined) {
    return stopped;
  }
  return { spoken, tagged, unparsed };
}

/**
 * Pass two: the latest message in each of those threads, whoever wrote it, and the few facts beside it that
 * `slack awaiting` reads (`./slackThreadFacts.ts`) — kept from the same parse, so no extra line is read.
 *
 * This one has to look at every line in the corpus, because the message that decides a thread — somebody
 * else's reply — carries the owner's id nowhere. `./slackRow.ts`'s `rawSourceId` fast path is what keeps it cheap.
 *
 * @param paths the bronze files to scan
 * @param keys the threads pass one found
 * @param ownerId the owner's own Slack id, which decides which messages join the owner's tail
 * @param stopWhen asked between chunks; once it answers true the scan stops and reports itself cut
 * @returns each thread's facts, the typed reason a file could not be read, or that the scan was cut
 */
export function latestPerThread({
  paths,
  keys,
  ownerId,
  stopWhen,
}: {
  paths: readonly string[];
  keys: ReadonlySet<string>;
  ownerId: string;
  stopWhen: (() => boolean) | undefined;
}): { facts: ReadonlyMap<string, ThreadFacts>; unparsed: number } | { refusal: IngestError } | { cut: true } {
  const state = { broadcastReactors: new Map<string, readonly string[]>(), facts: new Map<string, ThreadFacts>() };
  let unparsed = 0;
  const stopped = scanAll({
    onLine: ({ line }) => {
      unparsed += recordThreadLine({ keys, line, ownerId, state });
    },
    paths,
    stopWhen,
  });
  if (stopped !== undefined) {
    return stopped;
  }
  joinBroadcastReactors(state);
  return { facts: state.facts, unparsed };
}

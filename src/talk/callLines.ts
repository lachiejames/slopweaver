/**
 * One call file's lines, read tolerantly — the one reader `./callStore.ts` folds a call from and hands a caller
 * the raw lines through. Its own module because the store sits against the file-size ratchet.
 */
import { readJsonlLines } from "../corpus/corpusStore.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse } from "../lib/safeJson.js";
import { type CallEntry, callEntryOf } from "./callRecord.js";

/** One call file's lines that parsed, and the two counts a reader binding the owner's words must not read past. */
export interface CallLinesRead {
  readonly entries: readonly CallEntry[];
  /** Whether the call file was there to read: an absent one reads as no lines, never as lines that show no cut. */
  readonly present: boolean;
  /** Lines that did not parse at all. */
  readonly skipped: number;
  /**
   * Segment lines kept with a stamp that was present and unreadable, so read as absent. The page omits each when it
   * has none (`site/lib/talkTranscript.ts`), so a dropped one is a card the stretch WAS said over, a hand that WAS
   * named, or a start the line DID carry — and each decides which utterance a stretch falls in, so a dropped one can
   * hide the unfinished end of a landed utterance.
   */
  readonly stampsDropped: number;
}

/** The segment stamps the schema drops rather than refusing the line, each of which places a stretch in its run. */
const PLACING_STAMPS = ["open", "openBy", "beganIso"] as const;

/**
 * Why a call file read cannot say whether the owner's words in it were cut, when it cannot: a torn line might be
 * the cut stretch, and a dropped card stamp might be the unfinished end of a landed utterance.
 *
 * @param read the call file's lines and the two counts
 * @returns the reason a binding reader refuses on, or `undefined` when the file can say
 */
export function cutUnknownWhy({ read }: { read: CallLinesRead }): string | undefined {
  if (read.skipped > 0) {
    return `${String(read.skipped)} line(s) of the call do not parse, so whether its words were cut is unknown`;
  }
  if (read.stampsDropped > 0) {
    return `${String(read.stampsDropped)} stretch(es) of the call carry a stamp that does not read, so whether its words were cut is unknown`;
  }
  return undefined;
}

/** Whether a parsed line is a segment whose raw line carried a placing stamp the schema dropped. */
function stampDropped({ raw, entry }: { raw: unknown; entry: CallEntry }): boolean {
  if (entry.kind !== "segment" || !isRecord(raw)) {
    return false;
  }
  return PLACING_STAMPS.some((key) => raw[key] !== undefined && entry[key] === undefined);
}

/**
 * Read one call file's lines, a torn or unparseable line skipped and counted rather than failing the call.
 *
 * @param path the call file
 * @returns the lines that parsed, in file order, how many did not, and how many lost a placing stamp
 */
export function readCallLines({ path }: { path: string }): Result<CallLinesRead, unknown> {
  const entries: CallEntry[] = [];
  let skipped = 0;
  let stampsDropped = 0;
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        if (line.trim() === "") {
          return;
        }
        let raw: unknown;
        let entry: CallEntry | undefined;
        try {
          raw = safeJsonParse({ label: "call transcript line", text: line });
          entry = callEntryOf({ value: raw });
        } catch {
          entry = undefined;
        }
        if (entry === undefined) {
          skipped += 1;
          return;
        }
        entries.push(entry);
        if (stampDropped({ entry, raw })) {
          stampsDropped += 1;
        }
      },
      path,
      // The owner's stretches are quoted verbatim, so a byte that is not UTF-8 skips its line rather than reading repaired.
      strictUtf8: true,
    });
  } catch (cause) {
    return err(cause);
  }
  return ok({ entries, present: true, skipped, stampsDropped });
}

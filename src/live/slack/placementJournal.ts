/**
 * The placement journal: what every guarded Slack post's read-back found, and every repair it set out to make.
 *
 * Two kinds of row, the supersession journal's shape (`../turn/supersession/journal.ts`) for the same reason. A
 * REPAIR is irreversible — it deletes a message somebody may already have seen — so its INTENT is written before
 * the delete or the cross-link, and an intent with no matching result is a process that died mid-repair, visible
 * as one. Every post then ends in one RESULT row naming the message's FINAL identity: the repost when it moved,
 * the original otherwise. That second half is what makes this the register `slack followup` reads: the bot's own
 * messages, where they actually are, and which thread to re-read for a reply.
 *
 * Owner-only, like every journal under `live/slack/`: a row names a channel, a thread and message timestamps.
 * The append throws on failure and the guard answers that as an outcome rather than letting it escape a send that
 * already landed; the read is tolerant line by line and reports what it skipped. The append goes through
 * `../../lib/appendSeparator.ts`'s durable `appendLines`, as `../../talk/cardLandingStore.ts` does, so an intent row
 * is fsynced before the irreversible act it precedes.
 */
import { chmodSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

import { readJsonlLines } from "../../corpus/corpusStore.js";
import { appendLines } from "../../lib/appendSeparator.js";
import { isRecord } from "../../lib/parsers.js";
import { ensureDirectory } from "../../lib/writeAtomic.js";
import type { PlacedMessageRef, PlacementOutcome, SlackPlacementAddress } from "../../outbound/slack/placement.js";
import { stateHomePaths } from "../../stateHome.js";

/** The journal's schema version. Bumped when a row's SHAPE changes, never when a value is added. */
export const PLACEMENT_SCHEMA_VERSION = 1;

/** Owner-only permissions: a row names a conversation, a thread and message timestamps. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** The repair a mismatch called for: move an unengaged message, or link to an engaged one from where it belonged. */
export type PlacementRepairAct = "delete-and-repost" | "cross-link";

/** The intent row: a read-back found a misplaced post and this repair is about to run. */
interface PlacementRepairIntent {
  readonly kind: "placement-repair-intended";
  readonly schemaVersion: number;
  readonly tsIso: string;
  readonly posted: PlacedMessageRef;
  readonly intended: SlackPlacementAddress;
  readonly act: PlacementRepairAct;
  /** The non-self replies the engagement read found; empty for a move. */
  readonly engagement: readonly string[];
  readonly detail: string;
}

/** The result row: the one outcome a guarded post ended in, and where its message finally is. */
export interface PlacementSettled {
  readonly kind: "placement-settled";
  readonly schemaVersion: number;
  readonly tsIso: string;
  /** Which post method the guard wrapped, e.g. `postAssistantMessage`. */
  readonly surface: string;
  readonly intended: SlackPlacementAddress;
  readonly outcome: PlacementOutcome["kind"];
  /** The message as it finally stands: the repost for a move, the original otherwise. */
  readonly final: PlacedMessageRef;
  /**
   * The root of the thread {@link PlacementSettled.final} lives in, or its own ts when it is top level — the
   * thread a later re-read for replies opens. Absent when the read-back never saw the message.
   */
  readonly threadRoot?: string | undefined;
  /** Who Slack says posted it, off the read-back; absent when the read-back failed. */
  readonly botId?: string | undefined;
  readonly userId?: string | undefined;
  readonly detail?: string | undefined;
}

/** One row in the placement journal. */
export type PlacementJournalRow = PlacementRepairIntent | PlacementSettled;

const refSchema = z.object({ channel: z.string(), ts: z.string() });
const addressSchema = z.object({ channel: z.string(), threadTs: z.string().optional() });

const rowSchema = z.discriminatedUnion("kind", [
  z.object({
    act: z.enum(["delete-and-repost", "cross-link"]),
    detail: z.string(),
    engagement: z.array(z.string()),
    intended: addressSchema,
    kind: z.literal("placement-repair-intended"),
    posted: refSchema,
    schemaVersion: z.number(),
    tsIso: z.string(),
  }),
  z.object({
    botId: z.string().optional(),
    detail: z.string().optional(),
    final: refSchema,
    intended: addressSchema,
    kind: z.literal("placement-settled"),
    outcome: z.enum(["verified", "unverified", "moved", "held", "repair-failed"]),
    schemaVersion: z.number(),
    surface: z.string(),
    threadRoot: z.string().optional(),
    tsIso: z.string(),
    userId: z.string().optional(),
  }),
]);

/**
 * Parse one journal line, or `undefined` when it is not a row this version can read.
 *
 * @param line one line of the journal
 * @returns the row, or `undefined`
 */
function parsePlacementLine({ line }: { line: string }): PlacementJournalRow | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  const parsed = rowSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The placement journal's absolute path.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the path to `live/slack/placements.jsonl`
 */
function placementJournalPath({ home }: { home?: string } = {}): string {
  return stateHomePaths(home === undefined ? {} : { home }).live.slack.placementsJsonl;
}

/**
 * Append one row, owner-only, separating it from a torn earlier append rather than running into one.
 *
 * @param row the row to append
 * @param home the state home (defaults to the resolved home)
 */
export function appendPlacementRow({ row, home }: { row: PlacementJournalRow; home?: string }): void {
  const path = placementJournalPath(home === undefined ? {} : { home });
  const dir = dirname(path);
  ensureDirectory({ directory: dir });
  chmodSync(dir, DIR_MODE);
  appendLines({ durable: true, mode: FILE_MODE, path, text: `${JSON.stringify(row)}\n` });
  chmodSync(path, FILE_MODE);
}

/**
 * Read the whole journal, streamed. An absent file is an empty journal; any other failed open is reported.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the rows in file order, the 1-indexed lines that would not parse, and a failed open's cause
 */
export function readPlacementJournal({ home }: { home?: string } = {}): {
  readonly rows: readonly PlacementJournalRow[];
  readonly unreadable: readonly number[];
  readonly readFailure: string | undefined;
} {
  const rows: PlacementJournalRow[] = [];
  const unreadable: number[] = [];
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        const row = parsePlacementLine({ line });
        if (row !== undefined) {
          rows.push(row);
          return;
        }
        if (line.trim() !== "") {
          unreadable.push(index + 1);
        }
      },
      path: placementJournalPath(home === undefined ? {} : { home }),
    });
  } catch (cause) {
    if (isRecord(cause) && cause["code"] === "ENOENT") {
      return { readFailure: undefined, rows: [], unreadable: [] };
    }
    return { readFailure: cause instanceof Error ? cause.message : String(cause), rows: [], unreadable: [] };
  }
  return { readFailure: undefined, rows, unreadable };
}

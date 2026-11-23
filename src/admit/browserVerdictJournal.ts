/**
 * What the browser-door guard DECIDED — one append-only line per verdict.
 *
 * ## The measurement this exists for
 *
 * MEASURED (repro: `wc -l ~/.slopweaver/ledgers/door.jsonl` and
 * `grep -ci 'browser\|chrome\|playwright' ~/.slopweaver/ledgers/door.jsonl`): the door ledger held 191,753
 * rows and NOT ONE of them was a browser call. The Claude-in-Chrome guard journalled nothing about what it
 * decided — a refusal left no trace, and an allow left less than that — so a write-capable call on record
 * against a Google Admin tab could not be traced to the tool that took it, its URL, or whether the guard let
 * it through.
 *
 * ## What it is written with now
 *
 * The extension is retired, so the only verdict still WRITTEN is
 * `chrome-retired`, a block (`./chromeRetirement.ts`). The allow rows and the two break-glass waiver rows
 * (`break-glass-env`, `break-glass-grant`, each carrying the verdict it overrode under `waived`) were written
 * by the page-by-page engine deleted as unreachable. They are
 * still PARSED, because this file is append-only history and `slopweaver browser verdicts` reads it whole.
 *
 * Pure line-building and parsing here; the append is {@link appendBrowserVerdict}, the one effectful
 * function, allowlisted in the coverage scan as a local-state writer.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { appendLines } from "../lib/appendSeparator.js";
import { isRecord } from "../lib/parsers.js";
import { stateHomePaths } from "../stateHome.js";
import {
  BROWSER_VERDICT_REASONS,
  type BrowserDecision,
  type BrowserVerdictReason,
} from "./browserVerdictVocabulary.js";

/** Owner-only permissions, matching the `sessions/` journals — a row names a URL the owner was signed in to. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** Bumped when a field's MEANING changes, so a reader can tell one shape from another. */
export const BROWSER_VERDICT_SCHEMA_VERSION = 1;

/**
 * Why a refusal did not stick — the two legacy waiver codes a historical row may carry. Nothing writes
 * either since the retirement refusal stopped consulting any waiver; they stay parseable.
 */
type BrowserBreakGlassReason = "break-glass-env" | "break-glass-grant";

/**
 * Every reason code a journal line can carry: the guard's own, plus the two waivers.
 *
 * @internal the union a {@link BrowserJournalRecord} carries; callers read the record, never this alone.
 */
export type BrowserJournalReason = BrowserVerdictReason | BrowserBreakGlassReason;

/** The two waiver codes at runtime, so {@link isJournalReason} can validate against the whole closed set. */
const BREAK_GLASS_REASONS: readonly BrowserBreakGlassReason[] = ["break-glass-env", "break-glass-grant"];

/**
 * Whether a string read off a line is one of the codes this build knows.
 *
 * Validated rather than asserted, and a line carrying an unknown code is DROPPED like any other line that
 * will not decode. The alternative — trusting whatever the file says — is what makes a report count a
 * category that does not exist, and this journal's whole value is that its categories can be counted.
 *
 * @param value the code as the line spelled it
 * @returns true when it is a code this build defines
 */
function isJournalReason(value: string): value is BrowserJournalReason {
  return (
    BROWSER_VERDICT_REASONS.some((reason) => reason === value) || BREAK_GLASS_REASONS.some((reason) => reason === value)
  );
}

/**
 * Whether a string is one of the GUARD's own codes — the narrower set the `waived` field may hold.
 *
 * @param value the code as the line spelled it
 * @returns true when it is one of {@link BROWSER_VERDICT_REASONS}
 */
function isVerdictReason(value: string): value is BrowserVerdictReason {
  return BROWSER_VERDICT_REASONS.some((reason) => reason === value);
}

/** One journalled verdict, exactly as a line of the journal carries it. */
export interface BrowserJournalRecord {
  readonly schemaVersion: number;
  readonly tsIso: string;
  /** Claude Code's own `session_id` from the hook payload. */
  readonly sessionId: string;
  /** The tool's FULL MCP name, so a row is greppable by the name the transcript shows. */
  readonly toolName: string;
  /** What actually happened to the call. A waiver is an `allow` whose reason says why. */
  readonly verdict: "allow" | "block";
  readonly reason: BrowserJournalReason;
  readonly tabId?: number;
  readonly url?: string;
  /** The refusal text, on a block. Absent on an allow, which has none. */
  readonly message?: string;
  /** On a waiver: the reason the guard had refused with, before it was waived. */
  readonly waived?: BrowserVerdictReason;
  /** On a `break-glass-grant` waiver: the free text whoever recorded the grant wrote. */
  readonly grantReason?: string;
}

/**
 * The journal's absolute path.
 *
 * Its own file rather than rows in the door ledger: the door ledger's rows are `verb:<noun>.<verb>` decisions
 * with a status and findings, and a browser verdict shares none of those fields. One record set with two shapes
 * would make every reader of either one branch.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the path to `ledgers/browser-verdicts.jsonl`
 */
export function browserVerdictJournalPath({ home }: { home?: string } = {}): string {
  return join(stateHomePaths(home === undefined ? {} : { home }).ledgers, "browser-verdicts.jsonl");
}

/**
 * Build the record for one decided call.
 *
 * @param decision the guard's verdict, carrying its own reason code and subject
 * @param sessionId the hook payload's session id
 * @param toolName the tool's full MCP name
 * @param tsIso the instant to stamp — injected, never read from the clock, so this stays pure
 * @returns the record to append
 */
export function browserVerdictRecord({
  decision,
  sessionId,
  toolName,
  tsIso,
}: {
  decision: BrowserDecision;
  sessionId: string;
  toolName: string;
  tsIso: string;
}): BrowserJournalRecord {
  return {
    reason: decision.reason,
    schemaVersion: BROWSER_VERDICT_SCHEMA_VERSION,
    sessionId,
    toolName,
    tsIso,
    verdict: decision.block ? "block" : "allow",
    ...(decision.subject.tabId === undefined ? {} : { tabId: decision.subject.tabId }),
    ...(decision.subject.url === undefined ? {} : { url: decision.subject.url }),
    ...(decision.block ? { message: decision.message } : {}),
  };
}

/**
 * Parse one journal line.
 *
 * @param line one raw JSONL line
 * @returns the record, or `undefined` for a blank, malformed or incomplete line
 */
export function parseBrowserVerdictLine({ line }: { line: string }): BrowserJournalRecord | undefined {
  if (line.trim().length === 0) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const { reason, sessionId, toolName, tsIso, verdict } = parsed;
  if (
    typeof reason !== "string" ||
    !isJournalReason(reason) ||
    typeof sessionId !== "string" ||
    typeof toolName !== "string" ||
    typeof tsIso !== "string" ||
    (verdict !== "allow" && verdict !== "block")
  ) {
    return undefined;
  }
  const schemaVersion = parsed["schemaVersion"];
  const waived = parsed["waived"];
  return {
    reason,
    schemaVersion: typeof schemaVersion === "number" ? schemaVersion : BROWSER_VERDICT_SCHEMA_VERSION,
    sessionId,
    toolName,
    tsIso,
    verdict,
    ...(typeof parsed["tabId"] === "number" ? { tabId: parsed["tabId"] } : {}),
    ...(typeof parsed["url"] === "string" ? { url: parsed["url"] } : {}),
    ...(typeof parsed["message"] === "string" ? { message: parsed["message"] } : {}),
    ...(typeof waived === "string" && isVerdictReason(waived) ? { waived } : {}),
    ...(typeof parsed["grantReason"] === "string" ? { grantReason: parsed["grantReason"] } : {}),
  };
}

/**
 * Every record a journal's text holds, dropping the lines that will not decode.
 *
 * A line that will not parse is skipped rather than failing the read, for the same reason the grant journal
 * does it: this file is appended to by a `PreToolUse` hook, so a torn final write must not make every
 * earlier row invisible.
 *
 * @param text the journal's whole contents
 * @returns the decodable records, in file order
 */
export function parseBrowserVerdictJournal({ text }: { text: string }): readonly BrowserJournalRecord[] {
  return text
    .split("\n")
    .map((line) => parseBrowserVerdictLine({ line }))
    .filter((record): record is BrowserJournalRecord => record !== undefined);
}

/**
 * Read the journal, answering an empty list when there is none.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the decodable records, in file order
 */
export function readBrowserVerdicts({ home }: { home?: string } = {}): readonly BrowserJournalRecord[] {
  const records: BrowserJournalRecord[] = [];
  try {
    // A line at a time behind a bounded chunk, never the whole file in one string: this journal is
    // append-only with no ceiling, one row per browser call, so it is exactly the shape `whole-file-json`
    // refuses.
    readJsonlLines({
      onLine: ({ line }) => {
        const record = parseBrowserVerdictLine({ line });
        if (record !== undefined) {
          records.push(record);
        }
      },
      path: browserVerdictJournalPath(home === undefined ? {} : { home }),
    });
  } catch {
    return [];
  }
  return records;
}

/**
 * Append one record.
 *
 * Swallows its own failure, deliberately and unlike every other writer in this repository: the caller is a
 * `PreToolUse` hook whose job is to DECIDE, and a hook that threw because a log was unwritable would turn a
 * full disk into a wedged browser. Losing a row costs evidence; throwing here costs the verdict.
 *
 * @param record the record to write
 * @param home the state home (defaults to the resolved home)
 */
export function appendBrowserVerdict({ record, home }: { record: BrowserJournalRecord; home?: string }): void {
  try {
    mkdirSync(stateHomePaths(home === undefined ? {} : { home }).ledgers, { mode: DIR_MODE, recursive: true });
    appendLines({
      mode: FILE_MODE,
      path: browserVerdictJournalPath(home === undefined ? {} : { home }),
      text: `${JSON.stringify(record)}\n`,
    });
  } catch {
    // A verdict that could not be journalled is still a verdict. See the note above.
  }
}

/**
 * Where a dispatched worker writes down WHICH visible session it actually is — the one fact the loop needs
 * to render that worker's card from a good source, and the one fact only the worker itself can know.
 *
 * ## The gap this closes
 *
 * `turn watch` renders the card's `now:` line from the worker's own Claude Code transcript
 * (`./workerLog.ts`'s `latestWorkerActivity`), which carries the TOOL and its TARGET. It can do that because
 * it runs INSIDE the worker, so `detectSupervisorSession({ env })` hands it the session id for free. The
 * loop's `turn dispatch --sweep` runs somewhere else entirely and has no such environment, so its own
 * courtesy card push falls back to scraping the worker's terminal SCREEN (`./liveStatus.ts`) — a heuristic
 * over free-form text with no grammar, and the source of the `─` details measured on ask
 * `C0SYN000009/1789344513.735589`.
 *
 * The dispatch record (`./dispatch.ts`'s `FreshDispatchRecord`) already names the worker's `cwd`, host and
 * cmux workspace, but not its HOST SESSION id — cmux's workspace ref and Claude Code's session id are two
 * different identifiers, and only the second one names a transcript. So the worker records it here, and the
 * sweep reads it.
 *
 * ## Why a sidecar rather than a field on the dispatch record
 *
 * Two reasons, and the first is mechanical. `dispatchStore.ts`'s own header exists because `turn dispatch`
 * writes that record and the worker's `turn resume` reads it back immediately; making the worker a second
 * WRITER of the same file is precisely the race that atomic rename was chosen to avoid. The second is the
 * rule that module states about itself: the dispatch record holds request and LOCATOR facts decided at
 * dispatch time, never something a later process learned.
 *
 * This is the same shape, and the same reasoning, as `./turnMarkerStore.ts` — a separate file, keyed
 * identically, written by the worker, and **generation-bound by `leaseExpiresAt`** so a record left over
 * from an earlier attempt at the same ask can never be read as this attempt's.
 *
 * ## What it does NOT change
 *
 * Reading the transcript is reading a local file the harness wrote, from a session the owner can see, and no
 * model runs on this path — doctrine rule 2 is about a headless MODEL and starts none here. Nothing about
 * this record reaches a provider: it is one hop in deciding what the card's own detail line says.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "../../lib/parsers.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import { detectSupervisorSession } from "../../supervisor/session.js";
import type { AskIdentity } from "../ask/identity.js";
import { currentGenerationDispatchRecord } from "./dispatchStore.js";

/**
 * The visible session a dispatched worker is running as, in its own words.
 *
 * `cwd` is recorded alongside the id because a transcript path is a function of BOTH
 * (`./workerLog.ts`'s `transcriptPath` slugs the working directory), and the worker's own `process.cwd()` is
 * the authority on which checkout it opened — the dispatch record's `session.cwd` is the plan's intent,
 * which a worker that moved would leave wrong.
 */
export interface WorkerSessionRecord {
  readonly host: "claude-code" | "codex";
  readonly sessionId: string;
  readonly cwd: string;
  readonly leaseExpiresAt: string;
  /** When the worker last announced itself — a record refreshed on every `turn status`, not only at pickup. */
  readonly recordedAtIso: string;
}

/**
 * Where one ask's worker-session record lands — keyed identically to `dispatchRecordPath`, so re-dispatching
 * the same ask overwrites its own record and a different ask never collides.
 *
 * @param askIdentity the exact ask this worker was dispatched for
 * @param home the resolved state home
 * @returns the absolute path to read or write the record at
 */
export function workerSessionPath({ askIdentity, home }: { askIdentity: AskIdentity; home: string }): string {
  return join(
    stateHomePaths({ home }).live.slack.workerSessions,
    `${askIdentity.channel}-${askIdentity.messageTs}.json`,
  );
}

/**
 * Record which visible session this worker is, atomically. Never throws: a worker whose home is unwritable
 * still has a turn to run, and the only thing lost is the card's better detail source.
 *
 * @param askIdentity the exact ask this worker was dispatched for
 * @param home the resolved state home
 * @param record what the worker knows about itself
 * @returns whether the record reached disk
 */
export function writeWorkerSession({
  askIdentity,
  home,
  record,
}: {
  askIdentity: AskIdentity;
  home: string;
  record: WorkerSessionRecord;
}): boolean {
  try {
    writeFileAtomic({
      contents: `${JSON.stringify(record, null, 2)}\n`,
      path: workerSessionPath({ askIdentity, home }),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Announce, from inside the worker, which visible session it is — the one call `turn resume` and
 * `turn status` both make, so the loop's sweep has a transcript to read from the worker's first command
 * onward and keeps having one if the session is ever re-seated mid-turn.
 *
 * Three things make this a no-op rather than a failure, and each is deliberate: an ask with no CURRENT
 * dispatch record is not a dispatched turn at all (an inline turn calls `turn status` too); a session whose
 * host is `explicit` carries a session URL a caller typed, which names no transcript; and an unwritable home
 * costs the card its better detail source and nothing else. None of the three is worth failing a worker's
 * turn over.
 *
 * @param askIdentity the exact ask this worker was dispatched for
 * @param cwd the worker's own working directory — half of the transcript path
 * @param home the resolved state home
 * @param nowIso the instant to record the announcement at
 * @param session the visible session this process detected itself to be
 * @returns whether a record was written
 */
export function announceWorkerSession({
  askIdentity,
  cwd,
  home,
  nowIso,
  session,
}: {
  askIdentity: AskIdentity;
  cwd: string;
  home: string;
  nowIso: string;
  session: { readonly host: string; readonly id: string };
}): boolean {
  if (session.host !== "claude-code" && session.host !== "codex") {
    return false;
  }
  const record = currentGenerationDispatchRecord({ askIdentity, home });
  if (record === undefined) {
    return false;
  }
  return writeWorkerSession({
    askIdentity,
    home,
    record: {
      cwd,
      host: session.host,
      leaseExpiresAt: record.leaseExpiresAt,
      recordedAtIso: nowIso,
      sessionId: session.id,
    },
  });
}

/**
 * {@link announceWorkerSession} for THIS process, resolving its own session, directory and clock — the
 * one-line call `turn resume` and `turn status` actually make.
 *
 * The wrapper exists because both of those functions were already at this repo's line cap, and because the
 * three things it resolves are the same three every time: a caller that had to pass them could pass a
 * DIFFERENT session than the one whose transcript it is about, which is the only way this record can lie.
 *
 * @param askIdentity the exact ask this worker was dispatched for
 * @param home the resolved state home
 * @returns whether a record was written
 */
export function announceThisSession({ askIdentity, home }: { askIdentity: AskIdentity; home: string }): boolean {
  const detected = detectSupervisorSession({ env: process.env });
  if (detected.kind !== "active") {
    return false;
  }
  return announceWorkerSession({
    askIdentity,
    cwd: process.cwd(),
    home,
    nowIso: new Date().toISOString(),
    session: detected.session,
  });
}

/** Whether a value carries every field a {@link WorkerSessionRecord} declares. */
function isWorkerSessionRecord(value: unknown): value is WorkerSessionRecord {
  return (
    isRecord(value) &&
    (value["host"] === "claude-code" || value["host"] === "codex") &&
    typeof value["sessionId"] === "string" &&
    value["sessionId"].length > 0 &&
    typeof value["cwd"] === "string" &&
    value["cwd"].length > 0 &&
    typeof value["leaseExpiresAt"] === "string" &&
    typeof value["recordedAtIso"] === "string"
  );
}

/**
 * Read one ask's worker-session record back, but ONLY when it belongs to the ask's CURRENT dispatch
 * generation. Never throws: an absent file, invalid JSON, a record that fails validation, or one whose
 * `leaseExpiresAt` no longer matches the current generation all collapse to `undefined` — exactly as
 * `./turnMarkerStore.ts`'s reader does, and for the same reason.
 *
 * @param askIdentity the exact ask to read the worker session for
 * @param home the resolved state home
 * @returns the current generation's worker session, or `undefined` when none is recorded
 */
export function currentGenerationWorkerSession({
  askIdentity,
  home,
}: {
  askIdentity: AskIdentity;
  home: string;
}): WorkerSessionRecord | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(workerSessionPath({ askIdentity, home }), "utf8"));
  } catch {
    return undefined;
  }
  if (!isWorkerSessionRecord(raw)) {
    return undefined;
  }
  const record = currentGenerationDispatchRecord({ askIdentity, home });
  return record !== undefined && record.leaseExpiresAt === raw.leaseExpiresAt ? raw : undefined;
}

/**
 * Where a fresh-visible-session dispatch record LIVES — one writer, one reader, same-directory atomic
 * rename so a fresh workspace's pickup prompt can read a COMPLETE record the instant it starts.
 *
 * Atomic because the window it closes is real: `turn dispatch` writes the record, THEN the workspace's
 * pickup prompt runs `turn resume`, which reads it back immediately. A plain `writeFileSync` can be read
 * back partially written if the two ever race; a same-directory temp file plus `renameSync` cannot, because
 * a rename is atomic on the same filesystem and a reader only ever sees the old file or the new one, never a
 * half-written one.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { isRecord } from "../../lib/parsers.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import type { AskIdentity } from "../ask/identity.js";
import { askLifecycleKey, type DispatchedEvent, foldAskLifecycle, parseAskLifecycleLog } from "../ask/lifecycle.js";
import { readAskLifecycleText } from "../ask/store.js";
import { FRESH_DISPATCH_SCHEMA_VERSION, type FreshDispatchRecord, parseFreshDispatchRecord } from "./dispatch.js";

/**
 * Where a fresh-visible-session dispatch record lands for a given ASK — keyed the same way `briefStore.ts`
 * keys a brief, so re-dispatching the SAME ask overwrites its own record and a different ask never collides.
 *
 * @param askIdentity the exact ask this dispatch is for
 * @param home the resolved state home
 * @returns the absolute path to read or write the record at
 */
export function dispatchRecordPath({ askIdentity, home }: { askIdentity: AskIdentity; home: string }): string {
  return join(stateHomePaths({ home }).live.slack.dispatches, `${askIdentity.channel}-${askIdentity.messageTs}.json`);
}

/**
 * Write a dispatch record atomically and durably, creating its directory.
 *
 * @param record the record to persist
 * @param home the resolved state home
 */
export function writeDispatchRecord({ record, home }: { record: FreshDispatchRecord; home: string }): void {
  writeFileAtomic({
    contents: `${JSON.stringify(record, null, 2)}\n`,
    path: dispatchRecordPath({ askIdentity: record, home }),
  });
}

/**
 * Read one ask's dispatch record back, validated. An absent or unreadable file is `undefined`, never an
 * error — no dispatch record is the ordinary state for an ask that never reached the fresh-session tier.
 *
 * @param askIdentity the exact ask to read the record for
 * @param home the resolved state home
 * @returns the validated record, or `undefined` when none exists or it fails to parse
 */
export function readDispatchRecord({
  askIdentity,
  home,
}: {
  askIdentity: AskIdentity;
  home: string;
}): FreshDispatchRecord | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(dispatchRecordPath({ askIdentity, home }), "utf8"));
  } catch {
    return undefined;
  }
  const parsed = parseFreshDispatchRecord({ value: raw });
  return parsed.isOk() ? parsed.value : undefined;
}

/**
 * The raw `schemaVersion` an ask's dispatch record file carries, when it disagrees with the version this
 * build understands — the diagnostic {@link readDispatchRecord}'s blanket `undefined` collapses away. A
 * caller reporting "no dispatch record found" for a file that actually exists at an old version leaves an
 * operator staring at the wrong problem; this is what lets `turn resume`/`turn dispatch --poll` say exactly
 * which version is stale instead.
 *
 * @param askIdentity the exact ask whose record file to peek at
 * @param home the resolved state home
 * @returns the file's own `schemaVersion`, when it exists, is a number and differs from
 *   {@link FRESH_DISPATCH_SCHEMA_VERSION}; `undefined` when the file is absent, unreadable, carries no such
 *   field, or is already current
 */
export function unmatchedDispatchRecordVersion({
  askIdentity,
  home,
}: {
  askIdentity: AskIdentity;
  home: string;
}): number | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(dispatchRecordPath({ askIdentity, home }), "utf8"));
  } catch {
    return undefined;
  }
  const version = isRecord(raw) ? raw["schemaVersion"] : undefined;
  return typeof version === "number" && version !== FRESH_DISPATCH_SCHEMA_VERSION ? version : undefined;
}

/**
 * The reason clause to report when {@link currentGenerationDispatchRecord} returns `undefined` for an ask —
 * a version-specific "re-dispatch this ask" when a stale-schema file actually exists on disk, never the
 * generic "no dispatch record found" that collapses that case away and leaves an operator staring at the
 * wrong problem. Shared by `turn dispatch --poll`/`--sweep` and `turn resume`'s load/finish modes, so the
 * wording never drifts between them.
 *
 * @param askIdentity the exact ask a caller found no CURRENT record for
 * @param home the resolved state home
 * @returns the reason clause — generic when no file exists at all, version-specific when a stale one does
 */
export function noDispatchRecordReason({ askIdentity, home }: { askIdentity: AskIdentity; home: string }): string {
  const staleVersion = unmatchedDispatchRecordVersion({ askIdentity, home });
  return staleVersion === undefined
    ? "no dispatch record found"
    : `dispatch record is schema v${String(staleVersion)}, which this build no longer understands — re-dispatch this ask`;
}

/**
 * The ask-lifecycle log's CURRENT `dispatched` event for one ask, or `undefined` when the ask has no
 * unresolved dispatch (never dispatched, or a later event superseded it).
 *
 * @param askIdentity the ask to look up
 * @param home the resolved state home
 * @returns the current dispatched event, or `undefined`
 */
export function currentDispatchedEvent({
  askIdentity,
  home,
}: {
  askIdentity: AskIdentity;
  home: string;
}): DispatchedEvent | undefined {
  const folded = foldAskLifecycle({ events: parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events });
  // The fold's own `activeDispatch`, never `state === "dispatched"` — an observation appended over a live
  // dispatch (a recovery re-capture's `captured`/`checklist-posted`) moves `state` without ending anything,
  // and reading `state` here made a live worker's own record unreadable to it. See
  // `../ask/lifecycle.ts#AskLifecycle.activeDispatch`.
  return folded.get(askLifecycleKey({ askIdentity }))?.activeDispatch;
}

/**
 * The durable dispatch record for an ask, but ONLY when its own lease AND its own `decision` both match the
 * ask-lifecycle log's CURRENT `dispatched` event — never a record left over from a PRIOR generation, and
 * never one whose `decision` field has drifted from what the log says was actually dispatched.
 *
 * `dispatchId` alone cannot tell two dispatch GENERATIONS of a re-dispatched ask apart — it is derived from
 * the ask identity alone, on purpose, so `--poll`/`--dispatch`/`turn resume` share one token. A re-dispatch
 * (to a NEW tier or a NEW fresh-visible-session workspace) reuses that same id, so a record — or a decision —
 * left over from the OLD generation would still "match" by id alone. This is the ONE function every reader of
 * a dispatch record goes through, so that binding is never re-derived (and possibly forgotten) at a second
 * call site — `turn dispatch --sweep`/`--poll`, `turn answer --dispatch`, and `turn resume` all share it.
 *
 * The lease and decision fields live in TWO separate files — this log and the record — kept in lockstep only
 * by `recordFreshDispatch` writing both together. Checking the decision too, not just the lease, is what
 * stops a record whose `decision` field alone was hand-edited (or corrupted) from being trusted just because
 * its lease still happens to match.
 *
 * A residual named rather than hidden: `leaseExpiresAt` is derived from `new Date().toISOString()`, so two
 * dispatches of the SAME ask landing in the SAME millisecond would compute the identical lease and this
 * check alone could not distinguish them. That needs two dispatch calls for the identical ask essentially
 * simultaneously — the same single-visible-session-drives-one-ask-at-a-time premise named above already
 * rules that out in real operation, for the same reason the check-then-use window on this function's own
 * read is accepted rather than locked.
 *
 * @param askIdentity the ask to read the record for
 * @param home the resolved state home
 * @returns the record, or `undefined` when none exists, belongs to an earlier generation, or its decision
 *   does not match the log's own current one
 */
export function currentGenerationDispatchRecord({
  askIdentity,
  home,
}: {
  askIdentity: AskIdentity;
  home: string;
}): FreshDispatchRecord | undefined {
  const record = readDispatchRecord({ askIdentity, home });
  const dispatched = currentDispatchedEvent({ askIdentity, home });
  if (record === undefined || record.leaseExpiresAt !== dispatched?.leaseExpiresAt) {
    return undefined;
  }
  // The lease alone proves this record is the CURRENT generation, but not that its own `decision` field is
  // still the one the lifecycle log recorded — `writeDispatchRecord` and `appendAskLifecycleEvent` are two
  // separate files, and only `recordFreshDispatch` keeps them in lockstep. A hand-edited record could carry
  // a lease that matches while its decision has drifted from what was actually dispatched.
  return isDeepStrictEqual(record.decision, dispatched.decision) ? record : undefined;
}

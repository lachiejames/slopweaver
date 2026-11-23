/**
 * The durable, TUI-independent half of a fresh-visible-session dispatch's completion signal.
 *
 * `turn resume`'s finish step prints `SLOPWEAVER_TURN_READY {...}`/`SLOPWEAVER_TURN_FAILED {...}` to stdout,
 * then stops — `freshScreenTruth` (`./dispatch.ts`) is the read side of that, scraping a fresh workspace's
 * live terminal screen for the marker. That scrape depends on the host's own rendering: Claude Code's TUI
 * collapses a successful bash tool call's stdout into a one-line `Ran N shell command(s)` summary it does not
 * expand by default, so a marker that was genuinely printed can be genuinely invisible on the scraped screen —
 * `freshScreenTruth` then reports `working` forever, even though the turn finished and the answer is on disk.
 *
 * This module gives `turn resume` a SECOND, durable place to record that exact same marker — a file, checked
 * by the poller BEFORE it ever scrapes a screen. It deliberately does not live inside `dispatchStore.ts`'s own
 * record: that module's header states the dispatch record must never carry a cached completion state, because
 * an earlier design review (P3) found that pattern trustable-but-stale and the owner rejected it outright.
 * This file is not that pattern — it is not a belief about whether something is STILL true, it is the live
 * session's own one-time completion event, persisted in addition to being printed. What keeps it from
 * reintroducing P3's staleness is generation-binding: `dispatchId` alone cannot tell two dispatch generations
 * of a re-dispatched ask apart (it is a pure encoding of the ask identity, `dispatchIdOf` in `./dispatch.ts`),
 * so a marker is only ever honoured when its own `leaseExpiresAt` still matches
 * {@link currentGenerationDispatchRecord}'s CURRENT record for the same ask — the exact same binding that
 * function already uses to keep a stale dispatch record from being read as current.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "../../lib/parsers.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import type { AskIdentity } from "../ask/identity.js";
import type { FreshScreenTruth } from "./dispatch.js";
import { currentGenerationDispatchRecord } from "./dispatchStore.js";

/**
 * The durable completion signal for one `fresh-visible-session` dispatch — the same payload `turn resume`
 * prints as its stdout marker, plus the generation-binding token that keeps a stale one from being trusted.
 */
export type DurableTurnMarker =
  | {
      readonly kind: "ready";
      readonly dispatchId: string;
      readonly answerPath: string;
      readonly leaseExpiresAt: string;
      /**
       * When the session recorded this completion.
       *
       * A completion nobody carries through the door is the same green-light stall as a dispatch nobody is
       * running, seen from the other end — measured, when a turn reported ready and the
       * dispatching loop, having last polled a minute earlier, escalated that that nothing existed. Without
       * a time on the marker, a sweep can report `ready` but cannot say `ready for 40 minutes`, and only the
       * second of those reads as something to act on. Optional because markers written before this field
       * existed carry no time; an absent one means "unknown", never "just now".
       */
      readonly recordedAtIso?: string | undefined;
    }
  | { readonly kind: "failed"; readonly dispatchId: string; readonly reason: string; readonly leaseExpiresAt: string };

/**
 * Where one ask's durable turn marker lands — keyed identically to `dispatchRecordPath`, so re-dispatching
 * the same ask overwrites its own marker and a different ask never collides.
 *
 * @param askIdentity the exact ask this marker is for
 * @param home the resolved state home
 * @returns the absolute path to read or write the marker at
 */
export function turnMarkerPath({ askIdentity, home }: { askIdentity: AskIdentity; home: string }): string {
  return join(stateHomePaths({ home }).live.slack.turnMarkers, `${askIdentity.channel}-${askIdentity.messageTs}.json`);
}

/**
 * Write a durable turn marker atomically AND crash-durably, creating its directory.
 *
 * @param askIdentity the exact ask this marker is for
 * @param home the resolved state home
 * @param marker the marker to persist
 */
export function writeTurnMarker({
  askIdentity,
  home,
  marker,
}: {
  askIdentity: AskIdentity;
  home: string;
  marker: DurableTurnMarker;
}): void {
  writeFileAtomic({
    contents: `${JSON.stringify(marker, null, 2)}\n`,
    path: turnMarkerPath({ askIdentity, home }),
  });
}

/** Whether a value carries every field a {@link DurableTurnMarker} declares, of either kind. */
function isDurableTurnMarker(value: unknown): value is DurableTurnMarker {
  if (!isRecord(value) || typeof value["dispatchId"] !== "string" || typeof value["leaseExpiresAt"] !== "string") {
    return false;
  }
  if (value["recordedAtIso"] !== undefined && typeof value["recordedAtIso"] !== "string") {
    return false;
  }
  return (
    (value["kind"] === "ready" && typeof value["answerPath"] === "string") ||
    (value["kind"] === "failed" && typeof value["reason"] === "string")
  );
}

/**
 * Read one ask's durable turn marker back, but ONLY when it belongs to the ask's CURRENT dispatch
 * generation — never a marker left over from an earlier attempt at the same ask. Never throws: an absent
 * file, unreadable file, invalid JSON, a marker that fails validation, or one whose `leaseExpiresAt` no
 * longer matches the current generation's dispatch record all collapse to `undefined`, exactly like a stale
 * dispatch record does in {@link currentGenerationDispatchRecord}.
 *
 * @param askIdentity the exact ask to read the marker for
 * @param home the resolved state home
 * @returns the current-generation marker, or `undefined` when none exists or it belongs to a prior generation
 */
export function readCurrentGenerationTurnMarker({
  askIdentity,
  home,
}: {
  askIdentity: AskIdentity;
  home: string;
}): DurableTurnMarker | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(turnMarkerPath({ askIdentity, home }), "utf8"));
  } catch {
    return undefined;
  }
  if (!isDurableTurnMarker(raw)) {
    return undefined;
  }
  const record = currentGenerationDispatchRecord({ askIdentity, home });
  return record !== undefined && record.leaseExpiresAt === raw.leaseExpiresAt ? raw : undefined;
}

/**
 * Whether a current-generation marker still says something true once this dispatch's FIRST answer has been
 * posted — a ready marker recorded before that post is the plan's own completion, not the build's.
 *
 * A first answer (`../ask/lifecycleEvents.ts`'s `first-answered`) keeps the dispatch and its lease token, so
 * the marker the plan's `turn resume` wrote stays generation-bound and would read `ready` on every sweep
 * after it. Measured: a ready marker recorded five minutes before a plan posted, and
 * every later sweep reported `ready` over a workspace that was gone — so `phantom` could never fire. A
 * genuine post-plan completion always writes a newer marker in the same step, so ignoring an older one loses
 * nothing real. A `failed` marker is always honoured: the session's own failure report outranks the plan.
 *
 * @param marker the current-generation marker
 * @param notBeforeIso when the dispatch's first answer was posted, or `undefined` when none has been
 * @returns whether the marker may be read as this dispatch's truth
 */
export function markerOutlivesFirstAnswer({
  marker,
  notBeforeIso,
}: {
  marker: DurableTurnMarker;
  notBeforeIso: string | undefined;
}): boolean {
  if (notBeforeIso === undefined || marker.kind === "failed") {
    return true;
  }
  if (marker.recordedAtIso === undefined) {
    return false;
  }
  const recorded = Date.parse(marker.recordedAtIso);
  const notBefore = Date.parse(notBeforeIso);
  if (Number.isNaN(notBefore)) {
    return true;
  }
  return !Number.isNaN(recorded) && recorded >= notBefore;
}

/**
 * A durable turn marker, read as the {@link FreshScreenTruth} shape `freshScreenTruth` itself would have
 * produced — the caller-side conversion that lets `liveScreenRead` treat both sources identically.
 *
 * @param dispatchId the dispatch being polled
 * @param marker the current-generation marker to convert
 * @returns the equivalent `ready`/`failed` truth
 */
export function turnMarkerTruth({
  dispatchId,
  marker,
}: {
  dispatchId: string;
  marker: DurableTurnMarker;
}): FreshScreenTruth {
  return marker.kind === "ready"
    ? { answerPath: marker.answerPath, dispatchId, kind: "ready" }
    : { dispatchId, kind: "failed", reason: marker.reason };
}

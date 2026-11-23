import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { refuseUnlessConsolePress } from "../../../../lib/consolePress";
import { appendConsoleSyncFailure } from "../../../../lib/consoleSyncFailureAppend";
import { spawnVerb } from "../../../../lib/spawnVerb";
import { autoAttemptRefusedUntil, FOR_READING_PARAM } from "../../../../lib/syncFreshness";
import { type SyncVerb, syncVerbFor } from "../../../../lib/syncVerbs";

/**
 * Never prerendered, for the same reason the live route is not: the whole point of the request is that it
 * runs a verb now.
 */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/**
 * What the page receives from a press. No payload on purpose: the verb appended its document to the readings
 * ledger, and the page re-reads the ledger, so what it shows is what was RECORDED rather than a second copy
 * that could drift from it.
 */
export type SyncResult =
  | { readonly ok: true; readonly startedAtIso: string; readonly tookMs: number }
  | {
      readonly ok: false;
      readonly startedAtIso: string;
      readonly tookMs: number;
      readonly notMeasured: string;
      /** Set when nothing ran: another ask already claimed that reading inside the backoff, so no read failed. */
      readonly refused?: true;
    };

/**
 * The run in flight per sync slug, so two tabs — or the page's own stale-reading refresh racing a press — share
 * ONE provider read rather than starting two (`site/lib/syncFreshness.ts`). Module state, so it holds for the
 * one server process that serves the console; a second process would not see it, and none runs.
 */
const IN_FLIGHT = new Map<string, Promise<SyncResult>>();

/** Each `<slug> <reading id>` an automatic request ran for, and when — {@link autoAttemptRefusedUntil} says why. */
const AUTO_TRIED = new Map<string, number>();

/**
 * Run one sync verb and report it — the part a second request joins rather than repeats.
 *
 * @returns the run's outcome
 */
async function runSync({ verb }: { verb: SyncVerb }): Promise<SyncResult> {
  const startedAtIso = new Date().toISOString();
  const ran = await spawnVerb({ argv: verb.argv, timeoutMs: verb.timeoutMs, title: verb.title });
  if (!ran.ok) {
    // Recorded for the `console-sync-failed` monitor, so a failure is not visible only in the tab that pressed. A row
    // the ledger refused goes to its fallback, and the reply says where it went, or that neither would take it.
    const recorded = appendConsoleSyncFailure({
      failure: {
        failureId: randomUUID(),
        slug: verb.slug,
        startedAtIso,
        title: verb.title,
        tookMs: ran.tookMs,
        why: ran.notMeasured,
      },
    });
    let notMeasured = ran.notMeasured;
    if (recorded.kind !== "recorded") {
      notMeasured = `${ran.notMeasured}; ${recorded.notice}`;
    }
    return { notMeasured, ok: false, startedAtIso, tookMs: ran.tookMs };
  }
  return { ok: true, startedAtIso, tookMs: ran.tookMs };
}

/**
 * Take one reading on demand.
 *
 * POST rather than GET because a press runs a verb that appends to the ledger — a link prefetch or a
 * crawler must not be able to take one — and behind `refuseUnlessConsolePress`, because POST alone does not stop
 * another origin: a `no-cors` POST from an opaque origin could run it. The slug resolves
 * to a literal argv in `syncVerbs.ts` before anything is launched, and that list carries no flag that acts
 * outward.
 *
 * An automatic request — the page refreshing a stale reading, never a press — names the reading it would replace
 * as `?for-reading=<id>`. Any request joins a run already in flight; with none in flight, a second automatic one
 * naming the same reading inside the backoff is answered NOT TAKEN without running.
 *
 * @param request the request, whose `for-reading` parameter marks an automatic one
 * @param context the dynamic segment, which is the sync slug
 * @returns the press's outcome, a 403 for a request that is not a press from the console, or a 404 for a slug
 *   the list does not hold — a page bug, not a machine that would not answer
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ verb: string }> },
): Promise<NextResponse<SyncResult | { readonly error: string }>> {
  const notAPress = refuseUnlessConsolePress({ request });
  if (notAPress !== undefined) {
    return NextResponse.json({ error: notAPress }, { headers: { "cache-control": "no-store" }, status: 403 });
  }
  const { verb: slug } = await context.params;
  const verb = syncVerbFor({ slug });
  if (verb === undefined) {
    return NextResponse.json({ error: `no sync verb named ${slug}` }, { status: 404 });
  }
  // A run already in flight is joined, pressed or automatic: a second tab asking over the same reading is the
  // same question, and refusing it would print NOT TAKEN beside a run that is still going.
  const inFlight = IN_FLIGHT.get(slug);
  if (inFlight !== undefined) {
    return NextResponse.json(await inFlight, { headers: { "cache-control": "no-store" } });
  }
  const forReading = new URL(request.url).searchParams.get(FOR_READING_PARAM);
  const nowMs = Date.now();
  let refusedUntil: number | undefined;
  if (forReading !== null) {
    refusedUntil = autoAttemptRefusedUntil({ nowMs, readingId: forReading, slug, tried: AUTO_TRIED });
  }
  if (refusedUntil !== undefined) {
    const next = new Date(refusedUntil).toISOString();
    const refused: SyncResult = {
      notMeasured: `an automatic reading over ${String(forReading)} already ran and did not replace it; the next automatic try is from ${next}`,
      ok: false,
      refused: true,
      startedAtIso: new Date().toISOString(),
      tookMs: 0,
    };
    return NextResponse.json(refused, { headers: { "cache-control": "no-store" } });
  }
  const running = runSync({ verb }).finally(() => {
    IN_FLIGHT.delete(slug);
  });
  IN_FLIGHT.set(slug, running);
  return NextResponse.json(await running, { headers: { "cache-control": "no-store" } });
}

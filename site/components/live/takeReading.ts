/**
 * The POST every page-owned reading goes through: ask the sync route to run one `syncVerbs.ts` row, and say what it
 * answered. The shell takes the landing reading through it (`../console/useLandingAutoRefresh.ts`) and the Queue its
 * currency check (`../console/useCurrencyOpeningRefresh.ts`).
 */
import { FOR_READING_PARAM } from "../../lib/syncFreshness";

/**
 * A run's outcome, before the page says whether it pressed or the page did. `refused` is no run at all: another ask —
 * another tab's, usually — already claimed that reading inside the backoff, so nothing failed.
 */
export type SyncOutcome =
  | { readonly phase: "taken"; readonly tookMs: number; readonly atIso: string }
  | { readonly phase: "failed"; readonly why: string; readonly atIso: string }
  | { readonly phase: "refused"; readonly why: string; readonly atIso: string };

/**
 * What the sync route's answer means, pure: a run taken, a backoff refusal where nothing ran, or a failure with its
 * reason.
 *
 * @param body the route's JSON answer, untrusted
 * @param slug the `syncVerbs.ts` row asked for, named in a reason the answer did not carry
 * @param status the HTTP status the answer came with
 * @param atIso the instant the ask went out
 * @returns the outcome
 */
export function syncOutcomeOf({
  body,
  slug,
  status,
  atIso,
}: {
  body: unknown;
  slug: string;
  status: number;
  atIso: string;
}): SyncOutcome {
  if (typeof body !== "object" || body === null) {
    return { atIso, phase: "failed", why: `/api/sync/${slug} answered something that is not a SyncResult` };
  }
  const held = body as { ok?: unknown; tookMs?: unknown; notMeasured?: unknown; error?: unknown; refused?: unknown };
  if (held.ok === true && typeof held.tookMs === "number") {
    return { atIso, phase: "taken", tookMs: held.tookMs };
  }
  if (held.refused === true && typeof held.notMeasured === "string") {
    return { atIso, phase: "refused", why: held.notMeasured };
  }
  if (typeof held.notMeasured === "string") {
    return { atIso, phase: "failed", why: held.notMeasured };
  }
  if (typeof held.error === "string") {
    return { atIso, phase: "failed", why: held.error };
  }
  return { atIso, phase: "failed", why: `/api/sync/${slug} answered ${String(status)} with no reason` };
}

/**
 * POST the sync route and report what it said — a value either way, never a throw into the page.
 *
 * @param slug the `syncVerbs.ts` row to run
 * @param forReading the reading an automatic run would replace, which the route claims once; `undefined` for a press
 * @returns the run's outcome
 */
export async function takeReading({
  slug,
  forReading,
}: {
  slug: string;
  forReading: string | undefined;
}): Promise<SyncOutcome> {
  const atIso = new Date().toISOString();
  let address = `/api/sync/${slug}`;
  if (forReading !== undefined) {
    address = `${address}?${FOR_READING_PARAM}=${encodeURIComponent(forReading)}`;
  }
  try {
    // An empty JSON body only so the press carries the content type `consolePress.ts` requires.
    const response = await fetch(address, {
      body: "{}",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body: unknown = await response.json();
    return syncOutcomeOf({ atIso, body, slug, status: response.status });
  } catch (cause) {
    return { atIso, phase: "failed", why: cause instanceof Error ? cause.message : String(cause) };
  }
}

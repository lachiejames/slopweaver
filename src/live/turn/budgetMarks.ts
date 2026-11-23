/**
 * THE WARN MARK — the second mark on a dispatched turn's budget, sitting before the lease it already has.
 *
 * ## The ruling this implements, and the part it deliberately does not
 *
 * The owner ruled on the design page "One Budget, Two Marks": of its four questions the owner settled the
 * first, lean A — zero new sessions. The LOOP session raises the warn, on the `turn dispatch --sweep` pass it already runs. The warn
 * is a fact the worker weighs, never an instruction and never an ending: the worker decides, always.
 *
 * The page's other three questions — what the witness may say, where the marks sit (a per-ask deadline, a
 * ceiling), and a token bound — are UNRULED. So there is no per-ask deadline here, no ceiling, no step or
 * token dimension, and no conclude state: the lease is untouched and keeps doing exactly what it did, and the
 * warn mark is derived from it.
 *
 * ## Why two thirds, and why it is provisional
 *
 * A warn needs a place to sit before it can be raised at all, and this is the least-committal one: the
 * fraction the page's own Q3 lean proposed, applied to the lease every dispatch already carries rather than
 * to a per-ask deadline nobody has ruled on. On today's two-hour lease it lands at 80 minutes. MEASURED on the
 * incident that is this change's replay fixture — ask `1789186868.576709`, dispatched on a
 * two-hour lease and answered 3h40m later after six review rounds — the warn mark falls 80 minutes in, inside
 * its first review round, and nothing had told the worker a clock was running. Reproduce with
 * `jq -c 'select(.messageTs=="1789186868.576709") | {kind,tsIso,leaseExpiresAt}' "$SLOPWEAVER_HOME/live/slack/asks.jsonl"`.
 * Replace {@link WARN_MARK_FRACTION} with whatever the owner rules on Q3; do not tune it by feel.
 */

/**
 * Where on the dispatch-to-lease span the warn mark sits, as a fraction of it. Provisional — see this
 * module's header.
 */
const WARN_MARK_FRACTION = 2 / 3;

/** Where one dispatch generation stands against its warn mark, with the numbers that decided it. */
export type WarnMarkState =
  | { readonly kind: "invalid" }
  | {
      readonly kind: "before-warn" | "past-warn";
      readonly warnIso: string;
      /** Milliseconds since dispatch, floored at zero so a skewed clock never reads as negative time. */
      readonly elapsedMs: number;
      /** Milliseconds from dispatch to the lease. */
      readonly spanMs: number;
    };

/**
 * The warn mark's instant for one dispatch generation.
 *
 * @param dispatchedIso when the dispatch was recorded — the `dispatched` event's own `tsIso`
 * @param leaseExpiresAt the dispatch's lease
 * @returns the warn instant, or `undefined` when either instant is unreadable or the span does not move
 *   forward — a corrupt lease must never produce a mark that reads as already crossed
 */
export function warnMarkIso({
  dispatchedIso,
  leaseExpiresAt,
}: {
  dispatchedIso: string;
  leaseExpiresAt: string;
}): string | undefined {
  const start = Date.parse(dispatchedIso);
  const end = Date.parse(leaseExpiresAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return undefined;
  }
  return new Date(start + Math.round((end - start) * WARN_MARK_FRACTION)).toISOString();
}

/**
 * Which side of its warn mark a dispatch stands on at `nowIso`. Exactly at the mark is past it.
 *
 * @param dispatchedIso when the dispatch was recorded
 * @param leaseExpiresAt the dispatch's lease
 * @param nowIso the instant to judge at
 * @returns the state, or `invalid` when any instant cannot be read, so no caller raises a warn off garbage
 */
export function budgetMarkState({
  dispatchedIso,
  leaseExpiresAt,
  nowIso,
}: {
  dispatchedIso: string;
  leaseExpiresAt: string;
  nowIso: string;
}): WarnMarkState {
  const warnIso = warnMarkIso({ dispatchedIso, leaseExpiresAt });
  const now = Date.parse(nowIso);
  if (warnIso === undefined || !Number.isFinite(now)) {
    return { kind: "invalid" };
  }
  const start = Date.parse(dispatchedIso);
  return {
    elapsedMs: Math.max(0, now - start),
    kind: now >= Date.parse(warnIso) ? "past-warn" : "before-warn",
    spanMs: Date.parse(leaseExpiresAt) - start,
    warnIso,
  };
}

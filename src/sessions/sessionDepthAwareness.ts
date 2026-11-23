/**
 * The depth line EVERY session is told it has crossed — and that nothing stops it at.
 *
 * ## Awareness, not enforcement, and that is an owner ruling rather than a softening
 *
 * This module replaces a 500k-warn/600k-BLOCK gate that fired only for the cmux-pinned supervisor. Both
 * halves of that shape were wrong, and the ruling named the reason: _"blocking has
 * a chance of leading to some undesirable outcomes for something like this. And usually the issue is not so
 * much around blocking or not blocking, it's more that the agent doesn't even have awareness that there's a
 * problem. So warning is probably one of the easier ways to solve that."_
 *
 * So there is no block verdict here, no refusal text, no escape hatch and no break-glass grant — because
 * nothing is refused, there is nothing to waive. What is left is one thing: a session past the line is TOLD.
 *
 * ## Why the warned session is told NOT to act on it
 *
 * The same ruling put the decision somewhere specific: _"gut tells me purely supervisor should be the one who
 * probably looks at session depth and token spend and stuff like that. Because they're already kind of
 * managing the fleet."_ A warning that invited every session to weigh its own restart would put a lifecycle
 * decision in the hand of the session least able to judge it — the deep one — and would scatter a judgement
 * the fleet makes centrally. The text therefore states the depth and hands the decision to the supervisor's
 * `slopweaver session depth`.
 *
 * ## Why 500k, stated as the heuristic it is
 *
 * The owner treats 500-600k as a good-enough heuristic at the moment. It is a round number that marks where a supervisor should LOOK, not a measured cliff — and
 * the measurement says why nothing sharper is available. MEASURED over 822 transcripts touched
 * recently (133,445 assistant turns, deduplicated by `message.id`): a turn above 800k costs about 3.9x one
 * below 200k, while the cache hit rate RISES with depth (97.6% to 99.7%), so depth above 600k is 17.1% of
 * context-tokens but only 13.5% of notional spend. Whether a restart repays depends on how much work is
 * LEFT, which nothing in a `PreToolUse` payload can see. Reproduce the bands:
 *
 * ```
 * slopweaver session depth --json
 * ```
 *
 * Pure: numbers and text in, a verdict out. Nothing here reads a file or decides who is calling.
 */

/**
 * The depth at which a session is told, and nothing more.
 *
 * The advisory line, unchanged in value from the warn line of the gate this replaces — what changed is that
 * crossing it now has no consequence beyond being said out loud. Kept distinct from the supervisor's own
 * review threshold in `./tokenDepth.ts`: awareness starts here, and the economically-informed review a
 * supervisor performs starts higher.
 */
export const SESSION_DEPTH_WARN_TOKENS = 500_000;

/** What the advisory line says about one session's current depth. */
export type SessionDepthAwarenessDecision =
  { readonly kind: "allow" } | { readonly kind: "warn"; readonly context: string };

/**
 * A depth rendered the way the fleet gauge already renders one, so a warning and a `session depth` row agree.
 *
 * @param depthTokens the depth to render
 * @returns e.g. `612k`
 */
export function renderDepth({ depthTokens }: { depthTokens: number }): string {
  return `${String(Math.round(depthTokens / 1000))}k`;
}

/**
 * The advisory injected into a session's own context while it sits past the line.
 *
 * It deliberately does two things and refuses a third: it states the depth, and it names where the decision
 * lives. It does NOT hand the warned session a rule for acting on itself — see this module's header.
 *
 * @param depthTokens the session's current context depth
 * @param warnTokens the advisory line it has crossed (defaults to {@link SESSION_DEPTH_WARN_TOKENS})
 * @returns the advisory text
 */
export function sessionDepthWarning({
  depthTokens,
  warnTokens = SESSION_DEPTH_WARN_TOKENS,
}: {
  depthTokens: number;
  warnTokens?: number;
}): string {
  return (
    `Context depth: ${renderDepth({ depthTokens })} — past the ${renderDepth({ depthTokens: warnTokens })} advisory line. ` +
    "Nothing is blocked. Continue the current task; do not take a lifecycle action solely because of this warning. " +
    "Keep durable state current — the doc, the journal, the branch — so a handover stays cheap if one is called. " +
    "The supervisor owns any respawn or handover decision, and reads it from `slopweaver session depth`."
  );
}

/**
 * Whether this session's depth has crossed the advisory line.
 *
 * @param depthTokens the session's context depth, or `undefined` when it could not be measured — which
 *   ALLOWS silently, because a gauge that speaks up about its own blindness is noise on every turn
 * @param warnTokens the advisory line (defaults to {@link SESSION_DEPTH_WARN_TOKENS})
 * @returns the decision
 */
export function evaluateSessionDepthAwareness({
  depthTokens,
  warnTokens = SESSION_DEPTH_WARN_TOKENS,
}: {
  depthTokens: number | undefined;
  warnTokens?: number;
}): SessionDepthAwarenessDecision {
  if (depthTokens === undefined || depthTokens < warnTokens) {
    return { kind: "allow" };
  }
  return { context: sessionDepthWarning({ depthTokens, warnTokens }), kind: "warn" };
}

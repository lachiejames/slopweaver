/**
 * The CI verdict a `github checks --until` event watch announces: which line, and whether it is a failure.
 *
 * Split out of `./checksRun.ts`; the event loop that calls it now lives in `./checksEventWatch.ts`. These two
 * are pure and read nothing but the snapshot and the required-context gate.
 */

import { type GithubChecksSnapshot, isChecksTerminal, summarizeChecks } from "../../../live/github/checks.js";
import { type RequiredContextGate, withRequiredContextClause } from "../../../live/github/requiredContexts.js";

/**
 * The CI verdict line for a terminal snapshot, or `undefined` while a check is still running.
 *
 * A required context that never ran is a FAILED verdict, not a passing one with a caveat. Everything that
 * did run can be green while the gate the base actually enforces holds no verdict at all, and a watcher
 * whose whole purpose is to say "CI is green now" must not say it then.
 *
 * @param gate the base branch's required-context verdict for this head
 * @returns the `CI PASS`/`CI FAIL` line and whether it failed, or `undefined` while a check still runs
 */
function ciVerdictLine({
  snapshot,
  gate,
}: {
  snapshot: GithubChecksSnapshot;
  gate: RequiredContextGate;
}): { line: string; failed: boolean } | undefined {
  const summary = summarizeChecks({ checks: snapshot.checks });
  if (!isChecksTerminal({ summary })) {
    return undefined;
  }
  const sha = snapshot.headSha.slice(0, 8);
  if (summary.failed > 0) {
    const names = snapshot.checks.filter((check) => check.state === "failed").map((check) => check.name);
    return { failed: true, line: `CI FAIL ${names.join(", ")} on ${sha}` };
  }
  if (gate.kind === "read" && gate.missing.length > 0) {
    return { failed: true, line: `CI FAIL required context never ran: ${gate.missing.join(", ")} on ${sha}` };
  }
  if (gate.kind === "read" && gate.unproven.length > 0) {
    // `CI FAIL` and not a third token: the event vocabulary is the two this verb's help and
    // `skills/github/reference/review-state.md` both document, and the event really is "not green". Only the
    // reason differs, and it says UNPROVEN rather than claiming the context never ran.
    return {
      failed: true,
      line: `CI FAIL required context UNPROVEN on a truncated read: ${gate.unproven.join(", ")} on ${sha}`,
    };
  }
  return {
    failed: false,
    line: withRequiredContextClause({
      gate,
      line: `CI PASS ${String(summary.passed)}/${String(summary.total)} on ${sha}`,
    }),
  };
}

/**
 * The verdict to announce for this poll: once per head, never on the baseline poll.
 *
 * @param state the heads the previous poll saw and last announced a verdict for
 * @returns the verdict line to print, or `undefined` when there is nothing new to say
 */
export function verdictToAnnounce({
  state,
  head,
  snapshot,
  gate,
}: {
  state: { readonly previousHead: string | undefined; readonly verdictHead: string | undefined };
  head: string;
  snapshot: GithubChecksSnapshot;
  gate: RequiredContextGate;
}): { line: string; failed: boolean } | undefined {
  if (state.previousHead === undefined || state.verdictHead === head) {
    return undefined;
  }
  return ciVerdictLine({ gate, snapshot });
}

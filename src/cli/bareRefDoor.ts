/**
 * The bare-reference gate, at every outbound door.
 *
 * The rule: a PR number or ticket key never reaches a Slack message, a Notion page,
 * a Linear ticket or a pull-request body as plaintext — always a real link. `../outbound/linkify/bareRefs.ts`
 * resolves what it can; this door refuses whatever survives, the same shape `./aboveFoldDoor.ts` already
 * uses for the voice/packing rules — a plain interface rather than a neverthrow `Result`, because this is
 * CLI-glue reporting a verdict, not a domain operation that fails.
 *
 * Same way past too: the journalled `bare-refs` hatch, a grant one session takes with `slopweaver hatch
 * open` and the journal keeps, because the override is a decision one invocation makes on outbound text.
 */

import { grantEnvOf } from "../hatch/grantSession.js";
import { hatchOpen } from "../hatch/open.js";
import { BARE_REFS_HATCH, bareRefsEscapeSentence } from "../outbound/linkify/bareRefsHatch.js";

/** What the gate decided, given the issues a surface's own linkify pass reported as unresolved. */
interface BareRefVerdict {
  /** One operator-facing refusal per surviving bare reference. Empty when the hatch is open. */
  readonly refusals: readonly string[];
}

/**
 * Check the bare-reference issues a surface already computed (via its own `linkify*`/`bareRefIssuesOf*`
 * call) against the hatch.
 *
 * @param issues one message per bare reference still unresolved after linkifying
 * @param env the injected environment reader the session and state home are read through, so the grant is
 *   a decision a test can make rather than ambient state no test can reach
 * @param home the state home the verb resolved from its `--home` flag, whose grant journal decides the hatch
 * @returns the refusals to print; empty when there is nothing to refuse or this session holds a live grant
 */
export function bareRefVerdictFor({
  issues,
  env,
  home,
}: {
  issues: readonly string[];
  env: (args: { name: string }) => string | undefined;
  home: string;
}): BareRefVerdict {
  if (issues.length === 0) {
    return { refusals: [] };
  }
  if (hatchOpen({ env: grantEnvOf({ read: env }), home, id: BARE_REFS_HATCH, nowIso: new Date().toISOString() })) {
    return { refusals: [] };
  }
  return { refusals: issues.map((issue) => `${issue} ${bareRefsEscapeSentence()}`) };
}

/**
 * The dry-run report for one verdict, in the same shape a validator line uses.
 *
 * @param verdict what the gate decided
 * @param overridden whether a grant let the body through (so a caller can say what it bypassed)
 * @returns the lines to print, ending in a blank one
 */
function bareRefLines({ verdict, overridden }: { verdict: BareRefVerdict; overridden: boolean }): readonly string[] {
  if (verdict.refusals.length > 0) {
    return [`bare-reference gate: REFUSES this body:\n${verdict.refusals.map((r) => `  - ${r}`).join("\n")}`, ""];
  }
  if (overridden) {
    return [`bare-reference gate: violation(s) OVERRIDDEN by this session's live ${BARE_REFS_HATCH} grant`, ""];
  }
  return ["bare-reference gate: ACCEPTS this body", ""];
}

/**
 * Print every refusal on the door's own `refused:` channel, and say whether anything was refused.
 *
 * @param verdict what the gate decided
 * @param out the caller's output sink
 * @returns true when the write must not proceed
 */
export function printedBareRefRefusals({
  verdict,
  out,
}: {
  verdict: BareRefVerdict;
  out: (args: { line: string }) => void;
}): boolean {
  for (const refusal of verdict.refusals) {
    out({ line: `refused: ${refusal}` });
  }
  return verdict.refusals.length > 0;
}

/**
 * Run the gate at one door, report it, and say whether the write must stop.
 *
 * @param issues one message per bare reference still unresolved after linkifying
 * @param env the injected environment reader
 * @param home the state home the verb resolved from its `--home` flag, whose grant journal decides the hatch
 * @param dryRun whether this invocation stops before every effect
 * @param out the caller's output sink
 * @returns true when the verb must refuse
 */
export function bareRefGateRefused({
  issues,
  env,
  home,
  dryRun,
  out,
}: {
  issues: readonly string[];
  env: (args: { name: string }) => string | undefined;
  home: string;
  dryRun: boolean;
  out: (args: { line: string }) => void;
}): boolean {
  const verdict = bareRefVerdictFor({ env, home, issues });
  if (!dryRun) {
    return printedBareRefRefusals({ out, verdict });
  }
  for (const line of bareRefLines({ overridden: issues.length > 0 && verdict.refusals.length === 0, verdict })) {
    out({ line });
  }
  return verdict.refusals.length > 0;
}

/**
 * The one function that writes a refusal. Every block in this repository is this shape or it is a defect.
 *
 * ## The shape, and whose it is
 *
 * The owner's example of a good block:
 *
 * ```text
 * <command> blocked due to <reason/convention/etc>.
 * Legitimate exceptions may include <examples>.
 * To override use the designated escape hatch SLOPWEAVER_ALLOW_<suffix> = 1 <command>.
 * Use good judgement to determine whether the user would approve of this then proceed.
 * ```
 *
 * Four lines, four jobs, and each one answers a question the audit found refusals leaving open. *What was
 * blocked* and *what caught it* — because a bare "blocked" with no reason
 * does not help the agent. *Legitimate exceptions* — because the agent cannot weigh a rule it has
 * only seen the negative side of. *The designated hatch* — ruling 1, print the token, always. And the
 * *judgement note*, which is the one line here that is a constant rather than a field: judgement is first
 * class, so it is not something a gate author can forget, phrase weakly, or leave off.
 *
 * ## Why the judgement line is a constant
 *
 * The path of least resistance should lead an agent to do what the owner wants, so the refusal does not
 * replace judgement with a wall. The block stays, and it tells the agent it is allowed to think. A gate
 * that could word that line itself would eventually word it as "do not override", which is the failure this
 * whole structure is built against — so no gate can word it at all.
 */
import { type EscapeHatch, hatchIncantation } from "./types.js";

/**
 * The judgement note, verbatim in every refusal. Not a template field: see this file's header for why a
 * gate author cannot phrase, weaken or omit it.
 */
export const JUDGEMENT_NOTE =
  "Use good judgement to determine whether the owner would approve of this, then proceed or correct your approach.";

/**
 * Join the exception examples into the one clause the second line carries.
 *
 * Semicolons rather than commas because an exception is itself a clause that routinely contains a comma —
 * "a deliberate revert, where restoring the older version IS the change" reads as two exceptions under
 * comma joining and as one under this.
 *
 * @param exceptions the hatch's legitimate exceptions, in register order
 * @returns the joined clause, without a trailing stop
 */
export function exceptionClause({ exceptions }: { exceptions: readonly string[] }): string {
  return exceptions.join("; ");
}

/**
 * Render one refusal in the owner's required shape.
 *
 * `detail` is what this INVOCATION saw — the branch, the count, the seconds since the last poll — and is
 * appended to the reason so the same hatch reads differently on two different refusals. The four lines are
 * emitted whether or not a caller supplies one, so a lazy call site still produces a compliant block.
 *
 * @param hatch the register entry that owns this refusal
 * @param detail what this particular invocation observed, appended to the hatch's standing reason
 * @returns the four-line refusal, newline-joined, with no trailing newline
 */
export function hatchRefusal({ hatch, detail }: { hatch: EscapeHatch; detail?: string }): string {
  const because = detail === undefined || detail.length === 0 ? hatch.caught : `${hatch.caught} (${detail})`;
  // An ambient command key's incantation IS the whole command to run, so appending `hatch.command` after it
  // would tell the operator to type the verb twice. Every other incantation is a prefix to the command.
  const incantation = hatchIncantation({ hatch });
  const isWholeCommand = hatch.key.kind === "command" && hatch.lane === "ambient";
  const override = isWholeCommand ? incantation : `${incantation} ${hatch.command}`;
  return [
    `${hatch.command} blocked because ${because}.`,
    `Legitimate exceptions may include ${exceptionClause({ exceptions: hatch.exceptions })}.`,
    `To override use the designated escape hatch ${override}.`,
    JUDGEMENT_NOTE,
  ].join("\n");
}

/**
 * The same refusal as separate lines, for a caller that pushes into a `lines:` array or logs line by line
 * rather than writing one block. Identical content — split, never re-worded.
 *
 * @param hatch the register entry that owns this refusal
 * @param detail what this particular invocation observed
 * @returns the refusal's four lines, in order
 */
export function hatchRefusalLines({ hatch, detail }: { hatch: EscapeHatch; detail?: string }): readonly string[] {
  return hatchRefusal({ ...(detail === undefined ? {} : { detail }), hatch }).split("\n");
}

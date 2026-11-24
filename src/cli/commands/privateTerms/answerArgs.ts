/**
 * The typed option parser for `private-terms answer`, beside the noun's other parsers (`./core.ts`), whose flag spec
 * and shared readers it uses.
 *
 * Pure: no filesystem, no clock.
 */
import { PRIVATE_TERM_ANSWER_VIAS, type PrivateTermAnswerVia } from "../../../hygiene/privateTermAnswers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { parseFlags } from "../../parseFlags.js";
import { commonOf, type PrivateTermsCommonOptions, privateTermsSpec, targetOf, textOf } from "./core.js";

/** What `private-terms answer` was asked to record: the owner's yes or no to one proposal, and where it was given. */
export interface PrivateTermsAnswerOptions extends PrivateTermsCommonOptions {
  readonly proposalId: string;
  readonly answer: "yes" | "no";
  readonly via: PrivateTermAnswerVia;
  readonly bySession: string;
}

/**
 * Parse `private-terms answer <proposal-id> --as yes|no --via <where> --by-session <who>`.
 *
 * @param rest the argv after the noun and verb
 * @returns the options, or every reason it could not be one
 */
export function parsePrivateTermsAnswerArgs({ rest }: { rest: readonly string[] }): Result<PrivateTermsAnswerOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: privateTermsSpec({ verb: "answer" }) });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, positionals } = parsed.value;
  const problems: string[] = [];
  const target = targetOf({ positionals, what: "proposal id" });
  if (target.isErr()) {
    problems.push(...target.error);
  }
  const answer = values["as"];
  if (answer !== "yes" && answer !== "no") {
    problems.push('--as must be "yes" or "no": the owner\'s answer to that one proposal');
  }
  // A closed set, and a refused value is never echoed: `answer` prints where the answer was given, so free text
  // here would be a way for a word to reach stdout.
  const via = PRIVATE_TERM_ANSWER_VIAS.find((known) => known === values["via"]);
  if (via === undefined) {
    problems.push(`--via is required and is one of ${PRIVATE_TERM_ANSWER_VIAS.join(", ")}: where the owner answered`);
  }
  const bySession = textOf({ name: "by-session", values });
  if (bySession === undefined) {
    problems.push("--by-session is required: who recorded the answer");
  }
  if (target.isErr() || (answer !== "yes" && answer !== "no") || via === undefined || bySession === undefined) {
    return err(problems);
  }
  return ok({ answer, bySession, proposalId: target.value, via, ...commonOf({ values }) });
}

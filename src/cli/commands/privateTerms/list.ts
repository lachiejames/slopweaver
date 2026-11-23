/**
 * `slopweaver private-terms list` — every row of THE HANDS-FREE LIST by id, class, case and whether it carries a
 * meaning, then every proposal waiting. Never a pattern, a source or a meaning. The edit verbs are `./edit.ts`.
 */
import { readPrivateTermAnswer } from "../../../hygiene/privateTermAnswers.js";
import { parsePrivateTerms } from "../../../hygiene/privateTerms.js";
import { readCurrentPrivateTerms, waitingPrivateTermsProposals } from "../../../hygiene/privateTermsStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parsePrivateTermsListArgs, privateTermsUsage, VERB_ARG_OFFSET } from "./core.js";
import { asksHelp, failUsage, type PrivateTermsEditDeps, productionPrivateTermsEditDeps } from "./edit.js";
import { printEdgesUnderArgvHomes } from "./printGuard.js";

/** One row as the listing names it: flags only, never a cell's text. */
interface ListedRow {
  readonly allowedWhere: boolean;
  readonly caseInsensitive: boolean;
  readonly className: string;
  readonly meaning: boolean;
  readonly termId: string;
}

/** One proposal waiting, by id, with the owner's answer to it from the Queue card when they have given one. */
interface ListedProposal {
  readonly action: string;
  readonly proposalId: string;
  readonly termId: string;
  /** `yes` or `no` as recorded, `unanswered`, or `unreadable` for an answer file that does not read. */
  readonly answer: "yes" | "no" | "unanswered" | "unreadable";
}

/** The answer a listing names for one proposal. */
function answerOf({ home, proposalId }: { home: string; proposalId: string }): ListedProposal["answer"] {
  const read = readPrivateTermAnswer({ home, proposalId });
  if (read.kind === "answered") {
    return read.answer.answer;
  }
  if (read.kind === "none") {
    return "unanswered";
  }
  return "unreadable";
}

/** The rows and waiting proposals under one home, or the one line saying why there are none to list. */
function listing({
  home,
}: {
  home: string;
}): { readonly rows: readonly ListedRow[]; readonly waiting: readonly ListedProposal[] } | string {
  const current = readCurrentPrivateTerms({ home });
  if (current.isErr()) {
    return current.error.message;
  }
  if (current.value.kind === "absent") {
    return "private-terms list: no private terms file; every write refuses until one exists";
  }
  const terms = parsePrivateTerms({ text: current.value.text });
  if (terms.isErr()) {
    return terms.error.message;
  }
  const rows = terms.value.map((term) => ({
    allowedWhere: term.allowedWhere !== undefined,
    caseInsensitive: term.re.flags.includes("i"),
    className: term.className,
    meaning: term.meaning !== undefined,
    termId: term.termId,
  }));
  const waiting = waitingPrivateTermsProposals({ home }).map(({ action, proposalId, termId }) => ({
    action,
    answer: answerOf({ home, proposalId }),
    proposalId,
    termId,
  }));
  return { rows, waiting };
}

/** One row's line. */
function rowLine({ row }: { row: ListedRow }): string {
  const held = row.meaning ? "held for review on a match" : "refuses on a match (no meaning)";
  const where = row.allowedWhere ? "names where it is fine" : "names nowhere it is fine";
  const casing = row.caseInsensitive ? "case-insensitive" : "case-sensitive";
  return `${row.termId}  ${row.className}  ${casing}  ${held}, ${where}`;
}

/**
 * Run `private-terms list`: every row by id, class, case and whether it carries a meaning, then every proposal
 * waiting. Never a pattern, a source or a meaning.
 *
 * @param argv the full process argv
 * @param deps the injected edges
 * @returns the exit code
 */
export function runPrivateTermsList({
  argv,
  deps: given,
}: {
  argv: readonly string[];
  deps: PrivateTermsEditDeps;
}): number {
  const deps = printEdgesUnderArgvHomes({ argv, deps: given });
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (asksHelp({ rest })) {
    deps.out({ line: privateTermsUsage({ verb: "list" }) });
    return EXIT_OK;
  }
  const parsed = parsePrivateTermsListArgs({ rest });
  if (parsed.isErr()) {
    return failUsage({ deps, problems: parsed.error, verb: "list" });
  }
  const listed = listing({ home: resolveHome({ named: parsed.value.home }) });
  if (typeof listed === "string") {
    deps.writeDiagnostic({ line: listed });
    return EXIT_ERROR;
  }
  const { rows, waiting } = listed;
  if (parsed.value.json) {
    deps.out({ line: JSON.stringify({ rows, waiting }) });
    return EXIT_OK;
  }
  for (const row of rows) {
    deps.out({ line: rowLine({ row }) });
  }
  deps.out({ line: `${String(rows.length)} row(s)` });
  for (const one of waiting) {
    deps.out({ line: `waiting: proposal ${one.proposalId} to ${one.action} ${one.termId}, owner ${one.answer}` });
  }
  return EXIT_OK;
}

export const privateTermsListCommand = defineCommand({
  run: (argv) => runPrivateTermsList({ argv, deps: productionPrivateTermsEditDeps() }),
});

/**
 * `slopweaver private-terms list` — every row of THE HANDS-FREE LIST by id, class, case and whether it carries a
 * meaning, then every readable proposal waiting, each marked `current` or `stale` against the ONE read of the terms
 * file this invocation made. Stale means a confirm would refuse it as the file stands now; it is a fact about that
 * read, not a promise about a later one. Never a pattern, a source or a meaning. The edit verbs are `./edit.ts`,
 * retiring a proposal `./retire.ts`.
 */
import { readPrivateTermAnswer } from "../../../hygiene/privateTermAnswers.js";
import { parsePrivateTerms } from "../../../hygiene/privateTerms.js";
import { type PrivateTermsProposalAction, privateTermsProposalIsStale } from "../../../hygiene/privateTermsProposal.js";
import { readCurrentPrivateTerms, waitingPrivateTermsProposals } from "../../../hygiene/privateTermsStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parsePrivateTermsListArgs, privateTermsUsage, VERB_ARG_OFFSET } from "./core.js";
import { printEdgesUnderArgvHomes } from "./printGuard.js";
import { asksHelp, failUsage, type PrivateTermsCommandDeps, productionPrivateTermsCommandDeps } from "./runSupport.js";

/** The line printed, and the exit kept non-zero, when there is no terms file: every write refuses until one exists. */
const NO_TERMS_FILE = "private-terms list: no private terms file; every write refuses until one exists";

/** One row as the listing names it: flags only, never a cell's text. */
interface ListedRow {
  readonly allowedWhere: boolean;
  readonly caseInsensitive: boolean;
  readonly className: string;
  readonly meaning: boolean;
  readonly termId: string;
}

/**
 * One proposal waiting, by id, with the owner's answer to it from the Queue card when they have given one, and
 * whether a confirm would refuse it against the file as read.
 */
interface ListedProposal {
  readonly action: PrivateTermsProposalAction;
  readonly proposalId: string;
  readonly stale: boolean;
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

/** What one listing found: the rows, the waiting proposals, and whether the terms file was there at all. */
interface Listing {
  readonly absent: boolean;
  readonly rows: readonly ListedRow[];
  readonly waiting: readonly ListedProposal[];
}

/** The rows and waiting proposals under one home, or the one line saying why there are none to list. */
function listing({ home }: { home: string }): Listing | string {
  const current = readCurrentPrivateTerms({ home });
  if (current.isErr()) {
    return current.error.message;
  }
  const state = current.value;
  let rows: readonly ListedRow[] = [];
  if (state.kind === "present") {
    const terms = parsePrivateTerms({ text: state.text });
    if (terms.isErr()) {
      return terms.error.message;
    }
    rows = terms.value.map((term) => ({
      allowedWhere: term.allowedWhere !== undefined,
      caseInsensitive: term.re.flags.includes("i"),
      className: term.className,
      meaning: term.meaning !== undefined,
      termId: term.termId,
    }));
  }
  const waiting = waitingPrivateTermsProposals({ home }).map((proposal) => ({
    action: proposal.action,
    answer: answerOf({ home, proposalId: proposal.proposalId }),
    proposalId: proposal.proposalId,
    stale: privateTermsProposalIsStale({ proposal, state }),
    termId: proposal.termId,
  }));
  return { absent: state.kind === "absent", rows, waiting };
}

/** One row's line. */
function rowLine({ row }: { row: ListedRow }): string {
  const held = row.meaning ? "held for review on a match" : "refuses on a match (no meaning)";
  const where = row.allowedWhere ? "names where it is fine" : "names nowhere it is fine";
  const casing = row.caseInsensitive ? "case-insensitive" : "case-sensitive";
  return `${row.termId}  ${row.className}  ${casing}  ${held}, ${where}`;
}

/**
 * One waiting proposal's line. One that can never land, stale or answered no, carries the step that retires it.
 */
function waitingLine({ one, home }: { one: ListedProposal; home: string }): string {
  const mark = one.stale ? "stale" : "current";
  const head = `waiting: proposal ${one.proposalId} to ${one.action} ${one.termId}, owner ${one.answer} (${mark})`;
  if (!one.stale && one.answer !== "no") {
    return head;
  }
  return `${head}; retire it: slopweaver private-terms retire ${one.proposalId} --home ${home}`;
}

/**
 * Run `private-terms list`: every row by id, class, case and whether it carries a meaning, then every readable
 * proposal waiting, marked current or stale. Never a pattern, a source or a meaning. With no terms file it still
 * lists what is waiting, and still exits non-zero, because every write refuses until one exists.
 *
 * @param argv the full process argv
 * @param deps the injected print edges
 * @returns the exit code
 */
export function runPrivateTermsList({
  argv,
  deps: given,
}: {
  argv: readonly string[];
  deps: PrivateTermsCommandDeps;
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
  const home = resolveHome({ named: parsed.value.home });
  const listed = listing({ home });
  if (typeof listed === "string") {
    deps.writeDiagnostic({ line: listed });
    return EXIT_ERROR;
  }
  const { absent, rows, waiting } = listed;
  if (absent) {
    deps.writeDiagnostic({ line: NO_TERMS_FILE });
  }
  const exit = absent ? EXIT_ERROR : EXIT_OK;
  if (parsed.value.json) {
    deps.out({ line: JSON.stringify({ rows, waiting }) });
    return exit;
  }
  for (const row of rows) {
    deps.out({ line: rowLine({ row }) });
  }
  if (!absent) {
    deps.out({ line: `${String(rows.length)} row(s)` });
  }
  for (const one of waiting) {
    deps.out({ line: waitingLine({ home, one }) });
  }
  return exit;
}

export const privateTermsListCommand = defineCommand({
  run: (argv) => runPrivateTermsList({ argv, deps: productionPrivateTermsCommandDeps() }),
});

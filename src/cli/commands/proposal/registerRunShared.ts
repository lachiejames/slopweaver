/**
 * `ProposalRegisterDeps`, `VERB_ARG_OFFSET`, `refuse`, `refuseParse`, `announce` and `resolveEntry` — split out of
 * `./registerRun.js` so its verb siblings (`./registerRunRead.js`, `./registerRunFeedbackWrite.js`) can depend on
 * these without a circular import back through `registerRun.js`, which itself imports their runners.
 */
import type { RegisterEntry } from "../../../outbound/proposal/register/events.js";
import { loadRegisterEntry } from "../../../outbound/proposal/register/store.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type ProposalError, proposalErrorLines } from "./errors.js";

/** Where a verb's own arguments start in `process.argv`: after node, the script, the noun and the verb. */
export const VERB_ARG_OFFSET = 4;

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface ProposalRegisterDeps {
  readonly now: () => Date;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/**
 * Print each line to stderr and return the code.
 *
 * @param deps the injectable edges
 * @param lines the lines to print
 * @param code the exit code to return
 * @returns `code`, unchanged
 */
export function refuse({
  deps,
  lines,
  code,
}: {
  deps: ProposalRegisterDeps;
  lines: readonly string[];
  code: number;
}): number {
  for (const line of lines) {
    deps.err(line);
  }
  return code;
}

/**
 * Report a mutation's result, honouring `--json`.
 *
 * Every register mutation has always DECLARED `--json` and every one of them printed a human sentence
 * regardless, so the help was making a promise the code did not keep. One helper, so the next verb cannot
 * reintroduce the gap.
 *
 * @param json whether `--json` was passed, printing `payload` instead of `line`
 * @param line the human sentence printed without `--json`
 * @param payload the document printed with `--json`
 * @returns the success exit code
 */
export function announce({
  deps,
  json,
  line,
  payload,
}: {
  deps: ProposalRegisterDeps;
  json: boolean;
  line: string;
  payload: Readonly<Record<string, unknown>>;
}): number {
  deps.out(json ? JSON.stringify(payload, null, 2) : line);
  return EXIT_OK;
}

/**
 * Refuse an invocation its parser would not accept: one stderr line per problem, then the usage exit code.
 *
 * @param error what the parser refused the invocation for
 * @returns the usage exit code
 */
export function refuseParse({ deps, error }: { deps: ProposalRegisterDeps; error: ProposalError }): number {
  return refuse({ code: EXIT_USAGE, deps, lines: proposalErrorLines({ error }) });
}

/**
 * Load the entry a mutation is about to append to, or the refusal that stops it.
 *
 * @returns the loaded entry, or `undefined` once the refusal has been printed
 */
export function resolveEntry({
  home,
  slug,
  deps,
}: {
  home: string;
  slug: string;
  deps: ProposalRegisterDeps;
}): RegisterEntry | undefined {
  const loaded = loadRegisterEntry({ home, slug });
  if (loaded.isErr()) {
    refuse({ code: EXIT_ERROR, deps, lines: [loaded.error.message] });
    return undefined;
  }
  if (loaded.value === undefined) {
    refuse({ code: EXIT_EXPECTED_EMPTY, deps, lines: [`no proposal registered under "${slug}" — nothing to update`] });
    return undefined;
  }
  return loaded.value;
}

/**
 * `slopweaver supervisor chain` — the succession record `supervisor intake` walks, and the rescan that
 * rebuilds it from the transcripts.
 *
 * The chain maintains itself: `cmux pin` and `cmux takeover` append a link every time they move the pin.
 * This verb exists for the two cases that leaves open — SEEING the chain, and repairing one that is short
 * because the pin moved by hand, because the journal did not exist yet, or because a link's write failed.
 * `--rescan` reads every transcript on the machine and appends whatever the journal is missing; the cost is
 * in `../../../supervisor/chainScan.ts`, and it is why this is a verb somebody types rather than a sweep step.
 *
 * Diagnostic-shaped, exactly like `intake` beside it: a non-zero exit REPORTS an empty chain, never a broken
 * tool.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type SupervisorLink } from "../../../supervisor/chain.js";
import { missingLinks, scanSupervisorChain } from "../../../supervisor/chainScan.js";
import { appendSupervisorLink, readSupervisorChain } from "../../../supervisor/chainStore.js";
import { supervisorSessionLabel } from "../../../supervisor/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

const CHAIN_USAGE =
  "usage: slopweaver supervisor chain [--rescan] [--home <dir>] [--json]\n" +
  "\n" +
  "Lists every session that has held the supervisor pin, oldest first — the succession `supervisor intake`\n" +
  "walks. `cmux pin` and `cmux takeover` append to it themselves; --rescan recovers the links they missed by\n" +
  "reading every transcript on this machine for the session that invoked the supervisor skill.\n" +
  "\n" +
  "example: slopweaver supervisor chain --rescan";

/** `chain`'s flag tail — exported so `--help`'s advertised flags and the parser cannot drift. */
export const CHAIN_FLAG_SPEC = {
  boolean: ["rescan", "json"],
  value: ["home"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/** What `supervisor chain` resolves to. */
export interface ChainOptions {
  readonly rescan: boolean;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse `chain`'s flag tail. No I/O.
 *
 * @param rest the flag tail, after the noun/verb tokens
 * @returns the options, or every rejection
 */
export function parseChainOptions({ rest }: { rest: readonly string[] }): Result<ChainOptions> {
  const parsed = parseFlagTail({ rest, spec: CHAIN_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  return ok({ home: values["home"], json: flags.has("json"), rescan: flags.has("rescan") });
}

/** One link as a report line: when it took the pin, where the link came from, and the session it names. */
function linkLine({ link }: { link: SupervisorLink }): string {
  const ref = link.workspaceRef === "" ? "" : `  ${link.workspaceRef}`;
  return `  ${link.pinnedAtIso}  [${link.source}]  ${supervisorSessionLabel({ session: link.session })}${ref}`;
}

/** Append every link a rescan recovered that the journal did not already hold. */
function appendMissing({
  found,
  known,
  home,
}: {
  found: readonly SupervisorLink[];
  known: readonly SupervisorLink[];
  home: string;
}): Result<readonly SupervisorLink[]> {
  const missing = missingLinks({ found, known });
  const problems: string[] = [];
  for (const link of missing) {
    try {
      appendSupervisorLink({ home, link });
    } catch (cause: unknown) {
      problems.push(`${supervisorSessionLabel({ session: link.session })}: ${String(cause)}`);
    }
  }
  return problems.length > 0 ? err(problems) : ok(missing);
}

/**
 * `supervisor chain` — the succession record, and the rescan that repairs it.
 *
 * @param argv the full process argv
 * @returns the process exit code — non-zero when the chain is empty or a rescan could not complete
 */
function runChain(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: ["chain"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CHAIN_USAGE });
    return EXIT_OK;
  }
  const parsed = parseChainOptions({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: CHAIN_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const home = resolveHome({ named: options.home });
  const known = readSupervisorChain({ home });
  let added: readonly SupervisorLink[] = [];
  let scanned = 0;
  const problems: string[] = [];
  if (options.rescan) {
    const result = scanSupervisorChain({ projectsDir: join(homedir(), ".claude", "projects") });
    if (result.isErr()) {
      logger.error({ msg: `supervisor chain: ${result.error.join("; ")}` });
      return EXIT_ERROR;
    }
    scanned = result.value.transcriptsRead;
    problems.push(...result.value.problems);
    const appended = appendMissing({ found: result.value.links, home, known });
    if (appended.isErr()) {
      logger.error({ msg: `supervisor chain: could not extend the journal — ${appended.error.join("; ")}` });
      return EXIT_ERROR;
    }
    added = appended.value;
  }
  const chain = readSupervisorChain({ home });
  if (options.json) {
    logger.out({ line: JSON.stringify({ added, chain, problems, transcriptsRead: scanned }) });
    return chain.length === 0 ? EXIT_ERROR : EXIT_OK;
  }
  logger.out({
    line:
      `supervisor chain: ${String(chain.length)} session(s) have held the pin` +
      (options.rescan ? `, ${String(added.length)} recovered from ${String(scanned)} transcript(s)` : ""),
  });
  chain.forEach((link) => {
    logger.out({ line: linkLine({ link }) });
  });
  problems.forEach((problem) => {
    logger.error({ msg: `  incomplete: ${problem}` });
  });
  if (chain.length === 0) {
    logger.out({ line: "" });
    logger.out({ line: "no link is recorded — run `slopweaver supervisor chain --rescan` to recover them" });
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

export const supervisorChainCommand = defineCommand({ run: runChain });

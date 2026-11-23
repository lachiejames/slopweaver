/**
 * The effectful shell for `gmail triage-rules`: parse (pure), read the install's triage policy through the store
 * port, and either print them or — under `--set` — validate a whole replacement document and write it ONCE, pinned
 * to the revision just read. A concurrent change is a typed refusal and is never retried, because the writer
 * cannot know whether its document still says what the owner meant over the rows another writer left.
 *
 * Every edge is injected, so the exit codes and the single write are unit tested over an in-memory port.
 */
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { GmailTriageRulesError } from "../../../live/gmail/triageRuleErrors.js";
import {
  type GmailTriageRulesDocument,
  type GmailTriageRulesPort,
  gmailTriageRulesPort,
  inertRuleFileLine,
  readGmailTriageRulesFile,
} from "../../../live/gmail/triageRuleStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { gmailArgsErrorLines } from "./errors.js";
import { declaredChoiceCount, parseGmailTriageRulesArgs, renderGmailTriageRules } from "./triageRulesCore.js";

const VERB_ARG_OFFSET = 4;

/** The seams `gmail triage-rules` performs its effects through. */
export interface GmailTriageRulesDeps {
  readonly port: GmailTriageRulesPort;
  readonly readDocument: (args: {
    path: string;
  }) => Result<GmailTriageRulesDocument | undefined, GmailTriageRulesError>;
  readonly home: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** A refusal's exit: a document that was read and is wrong is the caller's to fix; every other failure is an error. */
function exitFor({ error }: { error: GmailTriageRulesError }): number {
  return error.code === "TRIAGE_RULES_MALFORMED" ? EXIT_USAGE : EXIT_ERROR;
}

/** The home `--home` named, else the injected default. */
function homeOf({ deps, named }: { deps: GmailTriageRulesDeps; named: string | undefined }): string {
  if (named !== undefined) {
    return named;
  }
  return deps.home();
}

/**
 * Read and validate a `--set` replacement document whole, before the store is touched.
 *
 * @returns undefined when no `--set` was given, the document when it read cleanly, else the exit code its
 *   refusal (already printed) answers
 */
function readReplacement({
  deps,
  path,
}: {
  deps: GmailTriageRulesDeps;
  path: string | undefined;
}): GmailTriageRulesDocument | number | undefined {
  if (path === undefined) {
    return undefined;
  }
  const document = deps.readDocument({ path });
  if (document.isErr()) {
    deps.writeDiagnostic(`gmail triage-rules: ${document.error.message} — nothing was written`);
    return exitFor({ error: document.error });
  }
  if (document.value === undefined) {
    deps.writeDiagnostic(`gmail triage-rules: ${path} does not exist — nothing was written`);
    return EXIT_ERROR;
  }
  return document.value;
}

/**
 * Run `gmail triage-rules` against injected edges.
 *
 * @param rest argv after `gmail triage-rules`
 * @param deps the port, the document read and the output seams
 * @returns the process exit code
 */
export async function runGmailTriageRules({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GmailTriageRulesDeps;
}): Promise<number> {
  const parsed = parseGmailTriageRulesArgs({ rest });
  if (parsed.isErr()) {
    for (const line of [...gmailArgsErrorLines({ error: parsed.error }), parsed.error.usage]) {
      deps.writeDiagnostic(line);
    }
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = homeOf({ deps, named: args.home });
  // The replacement is validated whole BEFORE the store is touched, so a malformed document writes nothing and
  // opens nothing.
  const replacement = readReplacement({ deps, path: args.set });
  if (typeof replacement === "number") {
    return replacement;
  }
  const read = await deps.port.read({ home });
  if (read.isErr()) {
    deps.writeDiagnostic(`gmail triage-rules: ${read.error.message}`);
    return exitFor({ error: read.error });
  }
  let snapshot = read.value;
  if (replacement !== undefined) {
    const written = await deps.port.replace({ document: replacement, expectedRevision: snapshot.revision, home });
    if (written.isErr()) {
      deps.writeDiagnostic(`gmail triage-rules: ${written.error.message}`);
      return exitFor({ error: written.error });
    }
    snapshot = written.value;
    deps.writeDiagnostic(`gmail triage-rules: wrote revision ${String(snapshot.revision)}`);
  }
  const inert = inertRuleFileLine({ snapshot });
  if (inert !== undefined) {
    deps.writeDiagnostic(`gmail triage-rules: ${inert}`);
  }
  deps.writeOut(renderGmailTriageRules({ json: args.json, snapshot }));
  return declaredChoiceCount({ snapshot }) === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/**
 * The production seams.
 *
 * @param port the store door the install's own archive rows are read and written through
 * @returns the port, the strict document read and the output sinks
 */
export function productionGmailTriageRulesDeps({ port }: { port: GmailTriageRulesPort }): GmailTriageRulesDeps {
  return {
    home: slopweaverHome,
    port,
    readDocument: readGmailTriageRulesFile,
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver gmail triage-rules`. */
export const gmailTriageRulesCommand = defineCommand({
  run: (argv) =>
    runGmailTriageRules({
      deps: productionGmailTriageRulesDeps({ port: gmailTriageRulesPort() }),
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});

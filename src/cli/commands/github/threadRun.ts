/** Effectful shell for the governed GitHub review-thread read and answer. */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { githubToken, slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import {
  type GithubThreadApi,
  makeGithubThreadApi,
  type ReviewThreadAnswer,
  type ReviewThreadDetail,
} from "../../../outbound/github/threads.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import { GithubVerbErrors, type GithubVerbResult, githubVerbErrorLines } from "./errors.js";
import { GITHUB_THREAD_USAGE } from "./prUsage.js";
import {
  type GithubThreadAnswerArgs,
  type GithubThreadListArgs,
  parseGithubThreadArgs,
  threadDoorRequest,
  threadLine,
} from "./threadCore.js";
import { repeatThreadReplyHatchOpen, threadRepeatRefusal } from "./threadRepeatGuard.js";

const VERB_ARG_OFFSET = 4;

/** Injectable edges for a no-network unit test. */
export interface GithubThreadDeps {
  readonly doorLedger: DoorLedgerPort;
  readonly home: () => string;
  readonly token: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => GithubThreadApi;
  readonly readStdin: () => Promise<string>;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** Whether the journalled `repeat-thread-reply` hatch is open — asked before the thread is read. */
  readonly repeatHatchOpen: (args: { home: string }) => boolean;
}

/** The state home: `--home` when given, else the resolved default. */
function stateHomeOf({
  args,
  deps,
}: {
  args: GithubThreadListArgs | GithubThreadAnswerArgs;
  deps: GithubThreadDeps;
}): string {
  if (args.home === undefined) {
    return deps.home();
  }
  return args.home;
}

/** Resolve the address to a node id, then read every thread on it. */
async function listThreads({
  api,
  args,
}: {
  api: GithubThreadApi;
  args: GithubThreadListArgs;
}): Promise<Result<readonly ReviewThreadDetail[]>> {
  const id = await api.pullRequestId({ number: args.number, owner: args.owner, repo: args.repo });
  if (id.isErr()) {
    return err([id.error.message]);
  }
  const threads = await api.list({ pullRequestId: id.value });
  return threads.isErr() ? err([threads.error.message]) : ok(threads.value);
}

/** Report `reply`/`resolve`/`reopen` in the selected output mode. */
function reportAnswer({
  deps,
  args,
  answer,
  outcome,
}: {
  deps: GithubThreadDeps;
  args: GithubThreadAnswerArgs;
  answer: ReviewThreadAnswer;
  outcome: string;
}): void {
  if (args.json) {
    deps.out(JSON.stringify({ outcome, thread: args.threadId, ...answer }, undefined, 2));
    return;
  }
  const parts: readonly (string | undefined)[] = [outcome, args.threadId, answer.commentUrl];
  deps.out(parts.filter((part) => part !== undefined).join("  "));
}

/** What the answer will do, in words, so `--dry-run` is readable rather than a shape dump. */
function plannedAnswer({ args }: { args: GithubThreadAnswerArgs }): string {
  if (args.subVerb === "resolve") {
    return "would resolve";
  }
  if (args.subVerb === "reopen") {
    return "would reopen";
  }
  return args.resolve ? "would reply and resolve" : "would reply to";
}

/** Read the reply body, taking `-` from stdin the way every other body-carrying verb does. */
async function bodyFor({
  deps,
  args,
}: {
  deps: GithubThreadDeps;
  args: GithubThreadAnswerArgs;
}): Promise<GithubVerbResult<string | undefined>> {
  if (args.subVerb !== "reply") {
    return ok(undefined);
  }
  if (args.body !== "-") {
    return args.body === undefined ? err(GithubVerbErrors.replyBodyMissing()) : ok(args.body);
  }
  const piped = (await deps.readStdin()).trim();
  return piped.length === 0 ? err(GithubVerbErrors.stdinBodyEmpty()) : ok(piped);
}

/** Run `list` — a pure read, so it never reaches the door. */
async function runList({ deps, args }: { deps: GithubThreadDeps; args: GithubThreadListArgs }): Promise<number> {
  const token = deps.token({ home: stateHomeOf({ args, deps }) });
  if (token === undefined) {
    deps.writeDiagnostic("no GitHub token configured; run `slopweaver connect github`");
    return EXIT_ERROR;
  }
  const threads = await listThreads({ api: deps.makeApi({ home: stateHomeOf({ args, deps }), token }), args });
  if (threads.isErr()) {
    threads.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    return EXIT_ERROR;
  }
  const shown = args.openOnly ? threads.value.filter((thread) => !thread.isResolved) : threads.value;
  if (args.json) {
    deps.out(JSON.stringify({ threads: shown }, undefined, 2));
    return EXIT_OK;
  }
  if (shown.length === 0) {
    deps.out(`no ${args.openOnly ? "unresolved " : ""}review threads on #${String(args.number)}`);
    return EXIT_OK;
  }
  shown.forEach((thread) => {
    deps.out(threadLine({ thread }));
    if (args.full) {
      thread.body.split("\n").forEach((line) => {
        deps.out(`    ${line}`);
      });
    }
  });
  return EXIT_OK;
}

/** Send the one irreversible answer through the door and report exactly what GitHub confirmed. */
async function sendAnswer({
  deps,
  args,
  home,
  api,
}: {
  deps: GithubThreadDeps;
  args: GithubThreadAnswerArgs;
  home: string;
  api: GithubThreadApi;
}): Promise<number> {
  const through = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: async (): Promise<Result<ReviewThreadAnswer>> => {
      if (args.subVerb === "reopen") {
        const reopened = await api.reopen({ threadId: args.threadId });
        return reopened.isErr() ? err([reopened.error.message]) : ok({ commentUrl: undefined, isResolved: false });
      }
      const sent = await api.answer({ body: args.body, resolve: args.resolve, threadId: args.threadId });
      return sent.isErr() ? err([sent.error.message]) : ok(sent.value);
    },
    request: threadDoorRequest({ args, home }),
  });
  if (!through.performed) {
    const refusal = notPerformedLines({
      command: `slopweaver github thread ${args.subVerb}`,
      through,
    });
    for (const line of refusal) {
      deps.writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  if (through.result.isErr()) {
    through.result.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    return EXIT_ERROR;
  }
  reportAnswer({
    answer: through.result.value,
    args,
    deps,
    outcome: sentOutcome({ args, answer: through.result.value }),
  });
  return EXIT_OK;
}

/** What GitHub confirmed, in words. */
function sentOutcome({ args, answer }: { args: GithubThreadAnswerArgs; answer: ReviewThreadAnswer }): string {
  if (args.subVerb === "reopen") {
    return "reopened";
  }
  return answer.isResolved === true ? "answered and resolved" : "answered";
}

/** Run `reply`, `resolve` or `reopen`: resolve the body, then either print the plan or send it once. */
async function runAnswer({
  deps,
  args,
  home,
}: {
  deps: GithubThreadDeps;
  args: GithubThreadAnswerArgs;
  home: string;
}): Promise<number> {
  const token = deps.token({ home });
  if (token === undefined) {
    deps.writeDiagnostic("no GitHub token configured; run `slopweaver connect github`");
    return EXIT_ERROR;
  }
  const body = await bodyFor({ args, deps });
  if (body.isErr()) {
    githubVerbErrorLines({ error: body.error }).forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    return EXIT_ERROR;
  }
  const resolved: GithubThreadAnswerArgs = { ...args, body: body.value };
  const api = deps.makeApi({ home, token });
  // Only a reply adds words to the thread; before `--dry-run` too, so a planned repeat says so now.
  const refusal =
    args.subVerb === "reply"
      ? await threadRepeatRefusal({ api, hatchIsOpen: deps.repeatHatchOpen({ home }), threadId: args.threadId })
      : undefined;
  if (refusal !== undefined) {
    deps.writeDiagnostic(refusal);
    return EXIT_ERROR;
  }
  if (args.dryRun) {
    reportAnswer({
      answer: { commentUrl: undefined, isResolved: undefined },
      args: resolved,
      deps,
      outcome: plannedAnswer({ args: resolved }),
    });
    return EXIT_OK;
  }
  return sendAnswer({ api, args: resolved, deps, home });
}

/**
 * Run the thread operation.
 *
 * @param argv the full process argv; this verb's arguments begin after node, CLI, "github" and "thread"
 * @param deps credential, client, stdin and output seams
 * @returns the process exit code
 */
export async function runGithubThread({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: GithubThreadDeps;
}): Promise<number> {
  const gated = refuseRunnerOnStandingRuling({ noun: "github", rest: argv.slice(VERB_ARG_OFFSET), verb: "thread" });
  if (gated !== undefined) {
    return gated;
  }
  const parsed = parseGithubThreadArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    for (const problem of githubVerbErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(GITHUB_THREAD_USAGE);
    return EXIT_USAGE;
  }
  return parsed.value.subVerb === "list"
    ? runList({ args: parsed.value, deps })
    : runAnswer({ args: parsed.value, deps, home: stateHomeOf({ args: parsed.value, deps }) });
}

/** Read all of stdin as UTF-8 — the `-` body source. */
async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Production GitHub, stdin and output seams.
 *
 * @returns credential, sanctioned write-client, stdin and output edges for the thread command
 */
export function productionGithubThreadDeps(): GithubThreadDeps {
  return {
    doorLedger: doorLedgerPort(),
    home: slopweaverHome,
    makeApi: ({ home, token }) => makeGithubThreadApi({ privacy: githubWritePrivacy({ home }), token }),
    out: (line) => {
      logger.out({ line });
    },
    readStdin: readAllStdin,
    repeatHatchOpen: repeatThreadReplyHatchOpen,
    token: ({ home }) => githubToken({ home }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
  };
}

/** `slopweaver github thread`. */
export const githubThreadCommand = defineCommand({
  run: (argv) => runGithubThread({ argv, deps: productionGithubThreadDeps() }),
});

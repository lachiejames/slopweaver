/**
 * `slopweaver talk code` — the bounded read of the serving checkout the console voice answers code questions
 * from. Three modes, one verb: `find`, `read`, `list`.
 *
 * Every refusal here is a failure of FACT, never a policy refusal with a hatch: an untracked file is not
 * something the caller is being DENIED, it is something this verb has no way to see. The refusals and the
 * reasons they are drawn where they are live in `src/talk/checkout.ts`.
 *
 * The verb states its own blind spot in its output: `untrackedInvisible: true` under `--json`, and a line
 * saying so in the human rendering. A reader who does not know that an answer excluded every uncommitted
 * file will read a confident "not found" as a fact about the tree.
 */
import { logger } from "../../../lib/logger.js";
import {
  type BoundedRead,
  readTrackedFile,
  resolveTalkCheckout,
  trackedFilesOf,
  undecodableUnder,
} from "../../../talk/checkout.js";
import { searchTrackedFiles } from "../../../talk/codeSearch.js";
import type { TalkError } from "../../../talk/errors.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type CodeArgs, parseCodeArgs } from "./args.js";
import { TALK_CODE_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "code", ...]`. */
const VERB_ARG_OFFSET = 4;

/** The one sentence every answer carries, because an unstated blind spot reads as a fact about the tree. */
const BLIND_SPOT = "tracked files only — anything uncommitted is invisible to this verb";

/**
 * Which directory the checkout is resolved from.
 *
 * An `if` that returns rather than a ternary, for the pair of rules `talk/args.ts`'s `stringOr` records:
 * the house rule bans `??` and oxlint rewrites the ternary back into one.
 *
 * @param cwd whatever `--cwd` carried, if anything
 * @returns the flag's directory, or the process's own
 */
function cwdOf({ cwd }: { cwd: string | undefined }): string {
  if (cwd === undefined) {
    return process.cwd();
  }
  return cwd;
}

/**
 * Run the `talk code` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkCode(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_CODE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCodeArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_CODE_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const rooted = resolveTalkCheckout({ cwd: cwdOf({ cwd: args.cwd }) });
  if (rooted.isErr()) {
    return fail({ failure: rooted.error });
  }
  const root = rooted.value;
  const listed = trackedFilesOf({ root });
  if (listed.isErr()) {
    return fail({ failure: listed.error });
  }
  const tracked = listed.value.paths;
  const { undecodable } = listed.value;
  if (undecodable.length > 0) {
    logger.error({
      msg:
        `talk code: ${String(undecodable.length)} tracked name(s) are not valid UTF-8 and were ` +
        `dropped — they are invisible to this verb, because a lossily decoded name is a different file`,
    });
  }
  if (args.mode === "list") {
    return runList({ args, root, tracked, undecodable });
  }
  if (args.mode === "read") {
    return runRead({ args, root, tracked });
  }
  return runFind({ args, root, tracked, undecodable: undecodable.length });
}

/**
 * The field a `--json` answer carries when tracked names were dropped, and nothing when none were: the console's
 * route reads stdout only on a success, so the stderr warning above never reaches the voice.
 *
 * @param undecodable how many tracked names were not valid UTF-8
 * @returns the field to spread into the document
 */
function undecodableField({ undecodable }: { undecodable: number }): { readonly undecodableNames?: number } {
  if (undecodable === 0) {
    return {};
  }
  return { undecodableNames: undecodable };
}

/** `talk code list` — the tracked files under a directory. */
function runList({
  args,
  root,
  tracked,
  undecodable,
}: {
  args: CodeArgs;
  root: string;
  tracked: readonly string[];
  undecodable: readonly Buffer[];
}): number {
  const prefix = args.dir === undefined ? "" : `${args.dir.replace(/\/+$/u, "")}/`;
  const paths = tracked.filter((path) => path.startsWith(prefix));
  if (args.json) {
    logger.out({
      line: JSON.stringify({
        checkoutRoot: root,
        dir: args.dir,
        paths,
        untrackedInvisible: true,
        ...undecodableField({ undecodable: undecodableUnder({ names: undecodable, prefix }) }),
      }),
    });
    return EXIT_OK;
  }
  paths.forEach((path) => {
    logger.out({ line: path });
  });
  logger.out({ line: `-- ${String(paths.length)} file(s), ${BLIND_SPOT}` });
  return EXIT_OK;
}

/**
 * The line `talk code read --json` prints — what the console voice is handed, so what `DEFAULT_CODE_BUDGET` has
 * to fit inside the page's tool cap.
 *
 * @param read one window of one tracked file
 * @param root the checkout it was read from
 * @returns the window as one compact JSON line
 */
export function codeReadJson({ read, root }: { read: BoundedRead; root: string }): string {
  return JSON.stringify({
    checkoutRoot: root,
    digest: read.digest,
    nextFrom: read.window.nextFrom,
    path: read.path,
    size: read.size,
    start: read.window.start,
    text: read.text,
    truncated: read.window.truncated,
    untrackedInvisible: true,
  });
}

/** `talk code read` — one bounded window of one tracked file. */
function runRead({ args, root, tracked }: { args: CodeArgs; root: string; tracked: readonly string[] }): number {
  const path = args.path;
  if (path === undefined) {
    logger.error({ msg: TALK_CODE_USAGE });
    return EXIT_USAGE;
  }
  const read = readTrackedFile({
    budget: args.budget,
    from: args.from,
    path,
    root,
    tracked: new Set(tracked),
  });
  if (read.isErr()) {
    return fail({ failure: read.error });
  }
  const value = read.value;
  if (args.json) {
    logger.out({ line: codeReadJson({ read: value, root }) });
    return EXIT_OK;
  }
  logger.out({ line: value.text });
  const tail =
    value.window.nextFrom === null
      ? `-- ${value.path}, whole file (${String(value.size)} bytes)`
      : `-- ${value.path}, bytes ${String(value.window.start)}..${String(value.window.end)} of ` +
        `${String(value.size)} — continue with --from ${String(value.window.nextFrom)}`;
  logger.out({ line: tail });
  return EXIT_OK;
}

/** `talk code find` — a literal search across tracked files. */
function runFind({
  args,
  root,
  tracked,
  undecodable,
}: {
  args: CodeArgs;
  root: string;
  tracked: readonly string[];
  undecodable: number;
}): number {
  const text = args.text;
  if (text === undefined) {
    logger.error({ msg: TALK_CODE_USAGE });
    return EXIT_USAGE;
  }
  const found = searchTrackedFiles({ maxHits: args.maxHits, root, text, tracked });
  if (found.isErr()) {
    return fail({ failure: found.error });
  }
  const result = found.value;
  if (args.json) {
    logger.out({
      line: JSON.stringify({
        checkoutRoot: root,
        ...result,
        text,
        untrackedInvisible: true,
        ...undecodableField({ undecodable }),
      }),
    });
    return EXIT_OK;
  }
  result.hits.forEach((hit) => {
    hit.lines.forEach((line) => {
      logger.out({ line: `${hit.path}:${String(line.line)}: ${line.excerpt}` });
    });
  });
  logger.out({
    line:
      `-- ${String(result.hits.length)} file(s) matched of ${String(result.filesScanned)} scanned ` +
      `(${String(result.binarySkipped)} binary skipped, ${String(result.aliasSkipped)} aliased); ${BLIND_SPOT}`,
  });
  return EXIT_OK;
}

/** Print a typed failure's own message and exit non-zero. */
function fail({ failure }: { failure: TalkError }): number {
  logger.error({ msg: `talk code: ${failure.message}` });
  return EXIT_ERROR;
}

export const talkCodeCommand = defineCommand({ run: runTalkCode });

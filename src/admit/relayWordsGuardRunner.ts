/**
 * The relay-words guard's runner: read the `PreToolUse` payload, decide it, and return the exit code (2 = block,
 * 0 = allow). The judgement is `./relayWordsJudge.ts`; this is the order the reads happen in, which is the guard's
 * whole cost story.
 *
 * ## The order is the cost
 *
 * 1. The payload, then the hatch: an open hatch reads nothing.
 * 2. The lexical target test (`./relayWordsTarget.ts`): every write that is not a Markdown file in the board or its
 *    archive ends here, with no file opened and no judgement module loaded.
 * 3. The row itself, once. A row that is not there is a new file, which `handover register` writes, not a hand edit.
 * 4. The judgement's modules, loaded only now — the board's reader and the relay's digest are not free to load, and
 *    a source edit must never pay for them.
 * 5. The plan: a write that leaves every protected part as it was ends here, having read only the row.
 * 6. Only the sources the plan names — the anchor's record when the quote changed, the turn when the summary or
 *    the offer did.
 *
 * FAILS OPEN on everything it cannot resolve — a malformed payload, an unreadable row, a judgement that throws (the
 * registry's `onUnhandledError`). It is a tripwire: a bug here must never wedge every file write in every session,
 * which an `Edit|Write` matcher makes possible. The one unresolvable thing it does NOT pass is a protected part that
 * changed against a turn that cannot be read: the change is the thing being guarded, and the hatch is the way past.
 *
 * Every reader is injected, so the whole path is unit-tested without a mock; the real ones are `./relayWordsSeams.ts`.
 */
import type { HisWordsRecord } from "../handover/hisWords.js";
import { isRecord } from "../lib/parsers.js";
import type { TurnRecord } from "../talk/relayStore.js";
import { EXIT_ALLOW, EXIT_BLOCK } from "./preToolUseDispatch.js";
import { relayWordsTarget } from "./relayWordsTarget.js";

/** The ambient variable this guard's register row names. */
const HATCH_ENV = "SLOPWEAVER_ALLOW_RELAY_WORDS";

/** Which payload field carries the text each judged tool is about to write. */
const TEXT_FIELDS: ReadonlyMap<string, string> = new Map([
  ["Write", "content"],
  ["Edit", "new_string"],
]);

/** What one payload asks to write, or `null` for anything the guard does not judge. */
interface RelayWordsPayload {
  readonly toolName: string;
  readonly filePath: string;
  readonly cwd: string | undefined;
  readonly text: string;
  readonly replacedText: string | null;
  readonly replaceAll: boolean;
}

/**
 * The write one raw payload asks for, or `null` for a payload that is not a judged write — a malformed one included,
 * because a guard that fails open must never wedge a tool call.
 *
 * @internal Reached from outside only by its test.
 * @param raw the payload exactly as the harness wrote it
 * @returns the write, or `null`
 */
export function relayWordsPayload({ raw }: { raw: string }): RelayWordsPayload | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(payload)) {
    return null;
  }
  const toolName = payload["tool_name"];
  const input = payload["tool_input"];
  if (typeof toolName !== "string" || !isRecord(input)) {
    return null;
  }
  const field = TEXT_FIELDS.get(toolName);
  if (field === undefined) {
    return null;
  }
  const filePath = input["file_path"];
  const text = input[field];
  if (typeof filePath !== "string" || typeof text !== "string") {
    return null;
  }
  const replaced = input["old_string"];
  const cwd = payload["cwd"];
  return {
    cwd: typeof cwd === "string" ? cwd : undefined,
    filePath,
    replaceAll: input["replace_all"] === true,
    replacedText: typeof replaced === "string" ? replaced : null,
    text,
    toolName,
  };
}

/** The readers the guard's judgement needs, each asked only when the plan names it. */
export interface RelayWordsReaders {
  /** The board directory of the home this hook guards. */
  readonly handoversDir: string;
  /** A directory through every symlink, `undefined` when it cannot be resolved. */
  readonly realDir: (args: { dir: string }) => string | undefined;
  /** A row's current text, `null` when there is none to read. */
  readonly readPrior: (args: { path: string }) => string | null;
  /** The record the anchor's turn holds now, as `handover quote` would store it. */
  readonly resolveRecord: (args: { anchor: string }) => Promise<HisWordsRecord>;
  /** The relay turn, `undefined` when it cannot be read. */
  readonly readTurn: (args: { turnId: string }) => Promise<TurnRecord | undefined>;
}

/**
 * The refusal one judged write earns, or `undefined` to allow — every read past the target test, in order.
 *
 * @param write the payload's write
 * @param path the absolute row path the write lands on
 * @param readers the injected readers
 * @returns the refusal text, or `undefined`
 */
async function refusalFor({
  write,
  path,
  readers,
}: {
  write: RelayWordsPayload;
  path: string;
  readers: RelayWordsReaders;
}): Promise<string | undefined> {
  const priorText = readers.readPrior({ path });
  if (priorText === null) {
    return undefined;
  }
  const [judge, projection] = await Promise.all([import("./relayWordsJudge.js"), import("./relayWordsProjection.js")]);
  const postText = projection.rowAfterWrite({
    priorText,
    replaceAll: write.replaceAll,
    replacedText: write.replacedText,
    text: write.text,
    toolName: write.toolName,
  });
  if (postText === undefined) {
    return undefined;
  }
  const plan = judge.planRelayWordsCheck({ path, postText, priorText });
  if (plan.kind === "allow") {
    return undefined;
  }
  const needs = judge.relayWordsSources({ plan });
  let record: HisWordsRecord | undefined;
  if (needs.record) {
    record = await readers.resolveRecord({ anchor: plan.anchor });
  }
  let turn: TurnRecord | undefined;
  if (needs.turn) {
    turn = await readers.readTurn({ turnId: plan.turnId });
  }
  return judge.relayWordsRefusal({ defects: judge.relayWordsDefects({ plan, record, turn }), path });
}

/**
 * Run the guard over one `PreToolUse` payload.
 *
 * @param readStdin reads the raw payload
 * @param writeError writes the refusal (stderr in production)
 * @param env the environment the escape hatch is read from
 * @param readers every reader past the payload, each asked only when the step before it says so
 * @returns the exit code (2 block, 0 allow)
 */
export async function runRelayWordsGuard({
  readStdin,
  writeError,
  env,
  readers,
}: {
  readStdin: () => Promise<string>;
  writeError: (line: string) => void;
  env: Readonly<Record<string, string | undefined>>;
  readers: RelayWordsReaders;
}): Promise<number> {
  let raw: string;
  try {
    raw = await readStdin();
  } catch {
    return EXIT_ALLOW; // fail open: an unreadable payload must never wedge a tool call
  }
  const write = relayWordsPayload({ raw });
  // Read as a local, never as a parameter default: `hatch-release` refuses a default initialiser.
  const hatchOpen = env[HATCH_ENV] === "1";
  if (write === null || hatchOpen) {
    return EXIT_ALLOW;
  }
  const path = relayWordsTarget({
    cwd: write.cwd,
    filePath: write.filePath,
    handoversDir: readers.handoversDir,
    realDir: readers.realDir,
    toolName: write.toolName,
  });
  if (path === undefined) {
    return EXIT_ALLOW;
  }
  const refusal = await refusalFor({ path, readers, write });
  if (refusal === undefined) {
    return EXIT_ALLOW;
  }
  writeError(`${refusal}\n`);
  return EXIT_BLOCK;
}

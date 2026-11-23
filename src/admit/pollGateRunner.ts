/**
 * The poll gate's runner: read the `PreToolUse` payload, classify the call, consult this session's poll
 * record, and return the exit code (2 = refuse, 0 = allow).
 *
 * FAILS OPEN on anything it cannot read — a malformed payload, a tool it does not judge, a missing session
 * id. It is a spend guard, not a security boundary: a bug here that failed closed would wedge every `Bash`
 * call in every session on the machine.
 *
 * Every reader and writer is injected, so the whole decision path is unit-tested without a mock.
 */
import { isRecord } from "../lib/parsers.js";
import { pollFingerprint } from "./pollFingerprint.js";
import { decidePoll, POLL_BREAK_GLASS } from "./pollGate.js";
import { type PollObservation, pollGatePath, readPollRecord, recordPoll } from "./pollGateStore.js";
import { pollReplacement } from "./pollReplacement.js";
import { classifyPollShape, type PollShape } from "./pollShape.js";
import { EXIT_ALLOW, EXIT_BLOCK } from "./preToolUseDispatch.js";

/** Linux's PATH_MAX, the larger of the two hosts' (darwin's is 1024): no longer cwd names a directory a stat reaches. */
const MAX_CWD_CHARS = 4096;

/**
 * The most words, paths and operands together, one call's token stats. Each is joined to the cwd and statted, so the
 * cost is words × cwd: this cap keeps it a fixed multiple of the cwd. A poll re-reading one log names a handful.
 */
const MAX_NAMED_WORDS = 64;

/** The change-token reader the runner is handed: the real filesystem in production, a fake in a test. */
type FingerprintOf = (input: {
  cwd: string;
  paths: readonly string[];
  operands: readonly string[];
}) => string | undefined;

/** The fields of a `PreToolUse` payload the gate judges, once each has the type it needs. */
interface PollPayload {
  readonly toolName: string;
  readonly toolInput: Readonly<Record<string, unknown>>;
  readonly sessionId: string;
  readonly cwd: unknown;
}

/**
 * Read the fields the gate judges out of the raw payload, or `undefined` for any payload it fails open on.
 *
 * @param read reads the raw payload
 * @returns the typed fields, or `undefined`
 */
async function readPollPayload({ read }: { read: () => Promise<string> }): Promise<PollPayload | undefined> {
  let payload: unknown;
  try {
    payload = JSON.parse(await read());
  } catch {
    return undefined;
  }
  if (!isRecord(payload)) {
    return undefined;
  }
  const toolName = payload["tool_name"];
  const toolInput = payload["tool_input"];
  const sessionId = payload["session_id"];
  if (typeof toolName !== "string" || !isRecord(toolInput) || typeof sessionId !== "string" || sessionId.length === 0) {
    return undefined;
  }
  return { cwd: payload["cwd"], sessionId, toolInput, toolName };
}

/**
 * The change token for a poll, or `undefined` when the poll is not one a token may vouch for.
 *
 * A relative path resolves against the payload's cwd and nothing else: guessing the hook process's own directory
 * could stat a different file and vouch for it. A poll that names no file is never fingerprinted: the classifier said
 * the token cannot cover it. Nor is one whose cwd is longer than any path the kernel resolves, or that names more words
 * than the cap, so the payload cannot make the stats arbitrarily large or many.
 *
 * @param cwd the payload's `cwd`, untyped as it arrived
 * @param shape the poll the classifier read
 * @param fingerprintOf the change-token reader
 * @returns the token, or `undefined`
 */
function pollToken({
  cwd,
  shape,
  fingerprintOf,
}: {
  cwd: unknown;
  shape: Extract<PollShape, { kind: "poll" }>;
  fingerprintOf: FingerprintOf;
}): string | undefined {
  const fingerprintable =
    typeof cwd === "string" &&
    cwd.length > 0 &&
    cwd.length <= MAX_CWD_CHARS &&
    shape.paths.length > 0 &&
    shape.paths.length + shape.operands.length <= MAX_NAMED_WORDS;
  return fingerprintable ? fingerprintOf({ cwd, operands: shape.operands, paths: shape.paths }) : undefined;
}

/**
 * Run the gate over one `PreToolUse` payload.
 *
 * @param readStdin reads the raw payload
 * @param writeError writes the refusal (stderr in production)
 * @param env the hook process's environment, for the break-glass
 * @param nowMs the current instant
 * @param readLastSeen resolves this session's last poll of a target (defaults to the real record file)
 * @param recordSeen records that this session polled a target now, with its change token (defaults to the real record file)
 * @param fingerprintOf the change token of the files a poll names (defaults to the real filesystem)
 * @returns the exit code (2 refuse, 0 allow)
 */
export async function runPollGate({
  readStdin: read,
  writeError,
  env,
  nowMs,
  readLastSeen = ({ sessionId, target }) => readPollRecord({ path: pollGatePath({ sessionId }) }).get(target),
  recordSeen = ({ sessionId, target, fingerprint }) => {
    recordPoll({ fingerprint, nowMs, path: pollGatePath({ sessionId }), target });
  },
  fingerprintOf = pollFingerprint,
}: {
  readStdin: () => Promise<string>;
  writeError: (line: string) => void;
  env: Readonly<Record<string, string | undefined>>;
  nowMs: number;
  readLastSeen?: (input: { sessionId: string; target: string }) => PollObservation | undefined;
  recordSeen?: (input: { sessionId: string; target: string; fingerprint: string | undefined }) => void;
  fingerprintOf?: FingerprintOf;
}): Promise<number> {
  const payload = await readPollPayload({ read });
  if (payload === undefined) {
    return EXIT_ALLOW;
  }
  const { cwd, sessionId, toolInput, toolName } = payload;
  const shape = classifyPollShape({ toolInput, toolName });
  if (shape.kind === "not-poll") {
    return EXIT_ALLOW;
  }
  const command = toolInput["command"];
  const fingerprint = pollToken({ cwd, fingerprintOf, shape });
  const last = readLastSeen({ sessionId, target: shape.target });
  const decision = decidePoll({
    allowPoll: env[POLL_BREAK_GLASS] === "1",
    fingerprint,
    lastFingerprint: last?.fingerprint,
    lastSeenMs: last?.atMs,
    nowMs,
    replacement: pollReplacement({
      command: typeof command === "string" ? command : undefined,
      target: shape.target,
    }),
    shape,
  });
  if (decision.kind === "block") {
    writeError(`${decision.message}\n`);
    return EXIT_BLOCK;
  }
  if (decision.record) {
    recordSeen({ fingerprint, sessionId, target: shape.target });
  }
  return EXIT_ALLOW;
}

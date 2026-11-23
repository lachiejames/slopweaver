/**
 * The shared FAIL-OPEN preamble every workflow-safety-net `Bash` guard runner starts from: read stdin, parse
 * it, and pull out what it needs from a well-formed `Bash` PreToolUse payload — `command`/`cwd` for the
 * main-checkout guards (`mainCheckoutDirtyGuardRunner.ts`, `mainCheckoutBranchGuardRunner.ts`), or
 * `command`/`session_id` for the session-scoped ones (`sessionDepthWarningRunner.ts`,
 * `cmuxSendSupervisorGuardRunner.ts`). Deliberately the OPPOSITE polarity of `hookPayload.ts`'s
 * `evaluateHookPayload` — that gate is a security boundary and fails closed on anything malformed; these
 * guards are workflow safety nets, so a malformed or unrelated payload must never wedge an unrelated tool
 * call, and `undefined` here always means "allow".
 */
import { isRecord } from "../lib/parsers.js";

/**
 * Read and parse stdin as a PreToolUse payload, returning the `Bash` command and cwd it named.
 *
 * @param readStdin reads the raw payload
 * @returns the command and cwd, or `undefined` on anything malformed, non-`Bash`, or missing either field
 */
export async function readBashToolCommand({
  readStdin,
}: {
  readStdin: () => Promise<string>;
}): Promise<{ command: string; cwd: string } | undefined> {
  let payload: unknown;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return undefined; // fail open: a malformed payload should never wedge an unrelated tool call
  }
  if (!isRecord(payload) || payload["tool_name"] !== "Bash") {
    return undefined;
  }
  const input = payload["tool_input"];
  const cwd = payload["cwd"];
  if (!isRecord(input) || typeof input["command"] !== "string" || typeof cwd !== "string") {
    return undefined;
  }
  return { command: input["command"], cwd };
}

/**
 * Read and parse stdin as a PreToolUse payload, returning the `Bash` command and the calling Claude session's
 * own id — what a session-scoped guard (matching against a recorded pin) needs instead of `cwd`.
 *
 * @param readStdin reads the raw payload
 * @returns the command and session id, or `undefined` on anything malformed, non-`Bash`, or missing either
 *   field
 */
export async function readBashSessionCommand({
  readStdin,
}: {
  readStdin: () => Promise<string>;
}): Promise<{ command: string; sessionId: string } | undefined> {
  let payload: unknown;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return undefined; // fail open: a malformed payload should never wedge an unrelated tool call
  }
  if (!isRecord(payload) || payload["tool_name"] !== "Bash") {
    return undefined;
  }
  const input = payload["tool_input"];
  const sessionId = payload["session_id"];
  if (!isRecord(input) || typeof input["command"] !== "string" || typeof sessionId !== "string") {
    return undefined;
  }
  return { command: input["command"], sessionId };
}

/**
 * {@link readBashSessionCommand} for BOTH tools that run a shell line — `Bash`, and a command `Monitor` —
 * for a guard whose subject is what the line does rather than how the `Bash` tool was called. A WebSocket
 * `Monitor` carries no `command` and reads as `undefined`, which is right: it runs no shell.
 *
 * @param readStdin reads the raw payload
 * @returns the command and session id, or `undefined` on anything malformed, another tool, or missing either
 *   field
 */
export async function readShellSessionCommand({
  readStdin,
}: {
  readStdin: () => Promise<string>;
}): Promise<{ command: string; sessionId: string } | undefined> {
  let payload: unknown;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return undefined; // fail open: a malformed payload should never wedge an unrelated tool call
  }
  if (!isRecord(payload) || (payload["tool_name"] !== "Bash" && payload["tool_name"] !== "Monitor")) {
    return undefined;
  }
  const input = payload["tool_input"];
  const sessionId = payload["session_id"];
  if (!isRecord(input) || typeof input["command"] !== "string" || typeof sessionId !== "string") {
    return undefined;
  }
  return { command: input["command"], sessionId };
}

/**
 * Read and parse stdin as a PreToolUse payload, returning which of the two shell-running tools it is and its
 * command — for a guard that judges a `Monitor` line differently from a `Bash` one. A WebSocket `Monitor` carries
 * no `command` and reads as `undefined`: it runs no shell.
 *
 * @param readStdin reads the raw payload
 * @returns the tool and command, or `undefined` on anything malformed, another tool, or commandless
 */
export async function readShellCommand({
  readStdin,
}: {
  readStdin: () => Promise<string>;
}): Promise<{ tool: "Bash" | "Monitor"; command: string } | undefined> {
  let payload: unknown;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return undefined; // fail open: a malformed payload should never wedge an unrelated tool call
  }
  if (!isRecord(payload)) {
    return undefined;
  }
  const tool = payload["tool_name"];
  const input = payload["tool_input"];
  if ((tool !== "Bash" && tool !== "Monitor") || !isRecord(input) || typeof input["command"] !== "string") {
    return undefined;
  }
  return { command: input["command"], tool };
}

/**
 * Read and parse stdin as a PreToolUse payload, returning the `Bash` command, whether the call runs in the
 * background, and the `timeout` it was submitted with. Claude Code sends `tool_input.run_in_background: true`
 * for a background call and omits the field for a foreground one (captured from a live payload),
 * so anything but `true` reads foreground. A background call is NOT beyond the harness's reach: it is killed at
 * its own `timeout`, which the payload omits when the caller did — so a non-number reads as absent.
 *
 * @param readStdin reads the raw payload
 * @returns the command, background flag and timeout, or `undefined` on anything malformed, non-`Bash`, or
 *   commandless
 */
export async function readBashExecution({
  readStdin,
}: {
  readStdin: () => Promise<string>;
}): Promise<{ command: string; runInBackground: boolean; timeoutMs: number | undefined } | undefined> {
  let payload: unknown;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return undefined; // fail open: a malformed payload should never wedge an unrelated tool call
  }
  if (!isRecord(payload) || payload["tool_name"] !== "Bash") {
    return undefined;
  }
  const input = payload["tool_input"];
  if (!isRecord(input) || typeof input["command"] !== "string") {
    return undefined;
  }
  const timeout = input["timeout"];
  let timeoutMs: number | undefined;
  if (typeof timeout === "number" && Number.isFinite(timeout)) {
    timeoutMs = timeout;
  }
  return { command: input["command"], runInBackground: input["run_in_background"] === true, timeoutMs };
}

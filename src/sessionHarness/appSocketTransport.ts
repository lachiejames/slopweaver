/**
 * The app harness's transport: one request to the desktop app's control plane over its owner-only socket, one
 * response back (`./appProtocol.ts`, the byte-for-byte mirror of `desktop/src/sessionControlProtocol.ts`).
 *
 * The answer is mapped into the seam's own errors HERE, once, so `./appHarness.ts` and `./appLaunch.ts` see only
 * the session vocabulary: no socket, no envelope. A missing or refusing socket is `HARNESS_UNAVAILABLE` naming the
 * app, never a silent fall back to cmux — `--harness app` asked for the app. An app speaking another protocol version
 * (its socket under another name, or an answer this version cannot read) is said in words: rebuild the app.
 */
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { connect } from "node:net";
import { basename } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import {
  APP_HARNESS_MAX_LINE_BYTES,
  APP_HARNESS_PROTOCOL_VERSION,
  type AppHarnessRequest,
  type AppHarnessResponse,
  type AppHarnessResponseEnvelope,
  appHarnessSocketPath,
  appLaunchBoundRefusal,
  isAppHarnessResponseEnvelope,
} from "./appProtocol.js";

/**
 * Where the installed app's per-user socket directory sits: `/tmp`, not `os.tmpdir()`, because a Mac app's
 * `$TMPDIR` is a per-process sandbox path a shell never sees, and the two must meet at one address.
 */
export const APP_SOCKET_ROOT = "/tmp";

/** How the app transport failed, before or after the control plane answered. */
export type AppTransportFailure =
  | { readonly kind: "unreachable"; readonly causeCode: string; readonly message: string }
  | { readonly kind: "refused"; readonly code: string; readonly message: string }
  | { readonly kind: "malformed"; readonly message: string };

/**
 * What a verb prints when the desktop app speaks another session protocol than this checkout: in words, never a bare
 * version number, because the one thing the reader can do about it is rebuild the app.
 */
export const APP_PROTOCOL_MISMATCH_MESSAGE =
  "the Slopweaver desktop app speaks a different session protocol from this checkout, so the desktop app must be " +
  "rebuilt: run `slopweaver desktop install` from this checkout, then try again";

/** The name every protocol version's socket takes inside the per-user directory. */
const PROTOCOL_SOCKET_NAME = /^session-harness-v\d+\.sock$/u;

/**
 * Whether the per-user directory holds another protocol version's socket and not this one's: an app built before
 * or after this checkout, listening where a verb of its own version would look.
 *
 * @param names the entries of the per-user socket directory
 * @param socketName the file name this checkout's protocol version listens on
 * @returns true when some other version's socket is there
 */
export function holdsOtherProtocolSocket({
  names,
  socketName,
}: {
  names: readonly string[];
  socketName: string;
}): boolean {
  return names.some((name) => name !== socketName && PROTOCOL_SOCKET_NAME.test(name));
}

/** The app is up, but on another protocol version's socket, so this checkout's verbs cannot reach it until rebuilt. */
const PROTOCOL_MISMATCH: AppTransportFailure = {
  causeCode: "PROTOCOL_MISMATCH",
  kind: "unreachable",
  message: APP_PROTOCOL_MISMATCH_MESSAGE,
};

/** The control plane wrote more than one protocol line's worth with no newline. */
const ANSWER_TOO_LONG: AppTransportFailure = {
  kind: "malformed",
  message: "the desktop app answered a line past the protocol's limit",
};

/** The control plane ended the connection before writing its answer line. */
const HUNG_UP: AppTransportFailure = {
  kind: "malformed",
  message: "the desktop app closed the connection without answering",
};

/** A socket that refused or errored, named by its errno code; one with no code is still a failure to reach the app. */
function notServing({ code, socket }: { code: string | undefined; socket: string }): AppTransportFailure {
  let causeCode = "SOCKET_ERROR";
  if (code !== undefined) {
    causeCode = code;
  }
  return {
    causeCode,
    kind: "unreachable",
    message: `the Slopweaver desktop app is not serving sessions at ${socket} (${causeCode}) — open the app, or use --harness cmux`,
  };
}

/**
 * Whether another protocol version's socket sits beside the one this checkout looked for. A directory that cannot
 * be read answers false, so the failure stays the plain not-serving one rather than a guess.
 *
 * @param directory the per-user socket directory
 * @param socket the full path this checkout's protocol version listens on
 * @returns true when an app of another version is listening there
 */
function otherProtocolListening({ directory, socket }: { directory: string; socket: string }): boolean {
  let names: readonly string[];
  try {
    names = readdirSync(directory);
  } catch {
    return false;
  }
  return holdsOtherProtocolSocket({ names, socketName: basename(socket) });
}

/** Sends one request and reads its answer; a fake in a test, the socket in production. */
export type AppTransport = (options: {
  readonly request: AppHarnessRequest;
  readonly timeoutMs: number;
}) => Promise<Result<AppHarnessResponse, AppTransportFailure>>;

/**
 * Read one response line into the answer, or the failure it carries.
 *
 * @param line the line the control plane wrote, newline excluded
 * @param requestId the id the request carried, which the response must echo
 * @returns the answer, or the failure
 */
export function readResponseLine({
  line,
  requestId,
}: {
  line: string;
  requestId: string;
}): Result<AppHarnessResponse, AppTransportFailure> {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return err({ kind: "malformed", message: "the desktop app answered a line that is not JSON" });
  }
  if (!isAppHarnessResponseEnvelope(value)) {
    return err({ kind: "malformed", message: APP_PROTOCOL_MISMATCH_MESSAGE });
  }
  const envelope: AppHarnessResponseEnvelope = value;
  if (envelope.requestId !== requestId) {
    return err({ kind: "malformed", message: "the desktop app answered a different request" });
  }
  if (envelope.outcome === "refused") {
    return err({ code: envelope.code, kind: "refused", message: envelope.message });
  }
  return ok(envelope.response);
}

/**
 * The production transport over the app's per-user socket.
 *
 * @param root where the per-user socket directory sits; `/tmp` for the installed app
 * @returns the transport
 */
export function socketAppTransport({ root }: { root: string }): AppTransport {
  return async ({ request, timeoutMs }) => {
    // Refused here, before the socket: an app from before the bound would host the session, and its overlong title
    // would then poison every list, picture and usage answer for the session's life.
    const overlong = appLaunchBoundRefusal({ request });
    if (overlong !== undefined) {
      return err({ code: "BAD_REQUEST", kind: "refused", message: overlong });
    }
    if (process.getuid === undefined) {
      return err({
        causeCode: "NO_UID",
        kind: "unreachable",
        message: "this platform has no user id to find the app's socket by",
      });
    }
    const { directory, socket } = appHarnessSocketPath({ root, uid: process.getuid() });
    const requestId = randomUUID();
    const line = `${JSON.stringify({ protocolVersion: APP_HARNESS_PROTOCOL_VERSION, request, requestId })}\n`;
    return new Promise((resolve) => {
      const connection = connect(socket);
      let buffered = "";
      const settle = ({ outcome }: { outcome: Result<AppHarnessResponse, AppTransportFailure> }): void => {
        clearTimeout(timer);
        connection.destroy();
        resolve(outcome);
      };
      const timer = setTimeout(() => {
        settle({
          outcome: err({
            causeCode: "TIMEOUT",
            kind: "unreachable",
            message: `the desktop app did not answer ${request.kind} within ${String(timeoutMs / 1000)}s`,
          }),
        });
      }, timeoutMs);
      connection.setEncoding("utf8");
      connection.once("connect", () => {
        connection.write(line);
      });
      connection.on("data", (chunk: string) => {
        buffered += chunk;
        const newline = buffered.indexOf("\n");
        if (newline !== -1) {
          settle({ outcome: readResponseLine({ line: buffered.slice(0, newline), requestId }) });
        } else if (Buffer.byteLength(buffered) > APP_HARNESS_MAX_LINE_BYTES) {
          settle({ outcome: err(ANSWER_TOO_LONG) });
        }
      });
      connection.once("error", (cause: NodeJS.ErrnoException) => {
        const mismatched = cause.code === "ENOENT" && otherProtocolListening({ directory, socket });
        settle({ outcome: err(mismatched ? PROTOCOL_MISMATCH : notServing({ code: cause.code, socket })) });
      });
      connection.once("end", () => {
        settle({ outcome: err(HUNG_UP) });
      });
    });
  };
}

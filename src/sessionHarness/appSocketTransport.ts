/**
 * The app harness's transport: one request to the desktop app's control plane over its owner-only socket, one
 * response back (`./appProtocol.ts`, the byte-for-byte mirror of `desktop/src/sessionControlProtocol.ts`).
 *
 * The answer is mapped into the seam's own errors HERE, once, so `./appHarness.ts` and `./appLaunch.ts` see only
 * the session vocabulary: no socket, no envelope. A missing or refusing socket is `HARNESS_UNAVAILABLE` naming the
 * app, never a silent fall back to cmux — `--harness app` asked for the app.
 */
import { randomUUID } from "node:crypto";
import { connect } from "node:net";

import { err, ok, type Result } from "#lib/result.js";
import {
  APP_HARNESS_MAX_LINE_BYTES,
  APP_HARNESS_PROTOCOL_VERSION,
  type AppHarnessRequest,
  type AppHarnessResponse,
  type AppHarnessResponseEnvelope,
  appHarnessSocketPath,
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
    return err({
      kind: "malformed",
      message: `the desktop app answered outside protocol v${String(APP_HARNESS_PROTOCOL_VERSION)} — is it older than this checkout?`,
    });
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
    if (process.getuid === undefined) {
      return err({
        causeCode: "NO_UID",
        kind: "unreachable",
        message: "this platform has no user id to find the app's socket by",
      });
    }
    const { socket } = appHarnessSocketPath({ root, uid: process.getuid() });
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
        settle({ outcome: err(notServing({ code: cause.code, socket })) });
      });
      connection.once("end", () => {
        settle({ outcome: err(HUNG_UP) });
      });
    });
  };
}

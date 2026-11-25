/**
 * The control plane's door: an owner-only Unix socket that `slopweaver` verbs reach the app through, one JSON request
 * per line and one JSON response per line (`sessionControlProtocol.ts`).
 *
 * Owner-only is checked, never assumed. The per-user directory is created `0700`, and an existing one is used only
 * when it is a real directory (not a link), owned by this user, with no group or other bits; the socket itself is
 * `0600`, and the socket must sit directly in that directory, since the directory's mode is what protects it in the
 * moment between listening and the `chmod` — and no connection is served until that `chmod` is done. A socket already at the path is probed: one that answers belongs to another running app and this one
 * refuses to start its control plane rather than steal it; one that refuses the connection is stale and removed.
 */
import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import { dirname, isAbsolute, resolve } from "node:path";

import { err, ok, type Result } from "neverthrow";

import {
  APP_HARNESS_MAX_LINE_BYTES,
  APP_HARNESS_PROTOCOL_VERSION,
  type AppHarnessRequestEnvelope,
  type AppHarnessResponseEnvelope,
  appLaunchBoundRefusal,
  isAppHarnessRequestEnvelope,
} from "./sessionControlProtocol";

/** Answers one well-formed request. */
export type RequestHandler = (envelope: AppHarnessRequestEnvelope) => Promise<AppHarnessResponseEnvelope>;

/**
 * The refusal for a line that is not a request this version accepts.
 *
 * @param requestId the line's request id, when one could be read
 * @param message what was wrong
 * @returns the refusal envelope
 */
export function badRequest({ requestId, message }: { requestId: string; message: string }): AppHarnessResponseEnvelope {
  return { code: "BAD_REQUEST", message, outcome: "refused", protocolVersion: APP_HARNESS_PROTOCOL_VERSION, requestId };
}

/**
 * Read one line off the wire into a request, or the refusal to send back.
 *
 * @param line one line, newline excluded
 * @returns the request, or the refusal
 */
export function parseRequestLine({
  line,
}: {
  line: string;
}): Result<AppHarnessRequestEnvelope, AppHarnessResponseEnvelope> {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return err(badRequest({ message: "the line is not JSON", requestId: "" }));
  }
  if (!isAppHarnessRequestEnvelope(value)) {
    const id =
      typeof value === "object" && value !== null && "requestId" in value && typeof value.requestId === "string"
        ? value.requestId
        : "";
    const overlong = currentVersionBoundRefusal({ value });
    if (overlong !== undefined) {
      return err(badRequest({ message: overlong, requestId: id }));
    }
    return err(
      badRequest({ message: `not a protocol v${String(APP_HARNESS_PROTOCOL_VERSION)} request`, requestId: id }),
    );
  }
  return ok(value);
}

/**
 * Why a line at this protocol version was refused for a launch field past the bound, so the refusal names the field
 * and the limit rather than only saying the request is malformed. Another version's line keeps the version refusal.
 */
function currentVersionBoundRefusal({ value }: { value: unknown }): string | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("protocolVersion" in value) ||
    value.protocolVersion !== APP_HARNESS_PROTOCOL_VERSION ||
    !("request" in value)
  ) {
    return undefined;
  }
  return appLaunchBoundRefusal({ request: value.request });
}

/**
 * Make the socket's directory `0700` if absent, and accept an existing one only when it is a real directory (never a
 * link, however it is spelled), owned by this user, with no group or other bits.
 *
 * @param directory the per-user directory the socket sits in
 * @returns nothing on success, else why the directory does not protect the socket
 */
export async function ownerOnlyDirectory({ directory }: { directory: string }): Promise<Result<void, string>> {
  // Resolved first: `lstat` FOLLOWS a symlink named with a trailing slash, so `/tmp/link/` would read as its target.
  const resolved = resolve(directory);
  await mkdir(resolved, { mode: 0o700, recursive: true });
  const stat = await lstat(resolved);
  const uid = process.getuid === undefined ? -1 : process.getuid();
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return err(`${directory} is not a real directory`);
  }
  if (stat.uid !== uid) {
    return err(`${directory} is owned by another user`);
  }
  if ((stat.mode & 0o077) !== 0) {
    return err(`${directory} is open to other users (mode ${(stat.mode & 0o777).toString(8)})`);
  }
  return ok(undefined);
}

async function socketAnswers({ socket }: { socket: string }): Promise<boolean> {
  return new Promise((settle) => {
    const probe = connect(socket);
    probe.once("connect", () => {
      probe.destroy();
      settle(true);
    });
    probe.once("error", () => {
      settle(false);
    });
  });
}

async function clearStaleSocket({ socket }: { socket: string }): Promise<Result<void, string>> {
  const stat = await lstat(socket).catch(() => undefined);
  if (stat === undefined) {
    return ok(undefined);
  }
  if (!stat.isSocket()) {
    return err(`${socket} exists and is not a socket`);
  }
  if (await socketAnswers({ socket })) {
    return err(`another Slopweaver app already serves ${socket}`);
  }
  await unlink(socket);
  return ok(undefined);
}

function serveConnection({ connection, handle }: { connection: Socket; handle: RequestHandler }): void {
  let buffered = "";
  connection.setEncoding("utf8");
  connection.on("data", (chunk: string) => {
    buffered += chunk;
    let newline = buffered.indexOf("\n");
    while (newline !== -1) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf("\n");
      const parsed = parseRequestLine({ line });
      void (parsed.isOk() ? handle(parsed.value) : Promise.resolve(parsed.error)).then(
        (answer) => !connection.destroyed && connection.write(`${JSON.stringify(answer)}\n`),
      );
    }
    if (Buffer.byteLength(buffered) > APP_HARNESS_MAX_LINE_BYTES) {
      connection.end(`${JSON.stringify(badRequest({ message: "the line is too long", requestId: "" }))}\n`);
    }
  });
  connection.on("error", () => {
    connection.destroy();
  });
}

/**
 * Listen on the control plane's socket.
 *
 * @param directory the per-user directory
 * @param socket the socket path inside it
 * @param handle answers each well-formed request
 * @returns the listening server, or why it could not listen
 */
export async function listenSessionSocket({
  directory,
  socket,
  handle,
}: {
  directory: string;
  socket: string;
  handle: RequestHandler;
}): Promise<Result<Server, string>> {
  const contained = socketInsideDirectory({ directory, socket });
  if (contained.isErr()) {
    return err(contained.error);
  }
  const safe = await ownerOnlyDirectory({ directory });
  if (safe.isErr()) {
    return err(safe.error);
  }
  const cleared = await clearStaleSocket({ socket });
  if (cleared.isErr()) {
    return err(cleared.error);
  }
  // Nothing is served until the socket is 0600: a connection that arrives before is closed unanswered.
  let ownerOnly = false;
  const server = createServer((connection) => {
    if (!ownerOnly) {
      connection.destroy();
      return;
    }
    serveConnection({ connection, handle });
  });
  const listening = await new Promise<Result<void, string>>((settle) => {
    server.once("error", (cause) => {
      settle(err(cause.message));
    });
    server.listen(socket, () => {
      settle(ok(undefined));
    });
  });
  if (listening.isErr()) {
    return err(listening.error);
  }
  await chmod(socket, 0o600);
  ownerOnly = true;
  return ok(server);
}

/**
 * Whether the socket sits directly in the owner-only directory, whose `0700` is what keeps other users out — the
 * socket's own mode is set only once it is already listening.
 *
 * @param directory the per-user directory
 * @param socket the socket path
 * @returns nothing, or why the socket is outside the directory
 */
export function socketInsideDirectory({
  directory,
  socket,
}: {
  directory: string;
  socket: string;
}): Result<void, string> {
  // `resolve(socket) === socket`: a `..` is resolved by the kernel AFTER any symlink before it, never lexically.
  if (!isAbsolute(socket) || resolve(socket) !== socket || dirname(socket) !== resolve(directory)) {
    return err(`${socket} is not directly inside ${directory}, so that directory's mode would not protect it`);
  }
  return ok(undefined);
}

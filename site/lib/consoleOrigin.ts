/**
 * Where this console server is serving from, as the flags `talk transcript` and `talk relay` take it —
 * `--console-root`, `--console-port`, `--console-default-port` — so the verb can refuse a console that is not the owner's
 * writing into their live home, and stamp every call it opens (`src/talk/callOrigin.ts`).
 *
 * Measured: a seat's witness run on its branch console at `localhost:3001` wrote two calls of synthesised speech
 * into the owner's real talk store as the owner.
 *
 * Every fact here is the SERVER's: the checkout comes from where the server runs (`./slopweaverBin.ts`), the port
 * from `PORT`, which `next start` and `next dev` set to the socket they listen on once they listen
 * (`next/dist/server/lib/start-server.js`), the default from `DOCS_SITE_PORT` as `scripts/docs-site.sh` reads it. The
 * page and the request supply none of them: measured, a request's `Host: localhost:3000` made a server listening on
 * :3001 read as the owner's console when the port was read off the request URL. Whether the checkout is
 * a main worktree is the verb's to ask git — `site/` cannot import `src/`.
 */
import { dirname, resolve } from "node:path";

import { slopweaverBin } from "./slopweaverBin";

/** The console's port when `DOCS_SITE_PORT` is unset — `scripts/docs-site.sh`'s own default. */
const CONSOLE_DEFAULT_PORT = 3000;

/** The console-origin flags for one request, or why none could be derived. */
export type ConsoleOriginArgv = { readonly argv: readonly string[] } | { readonly refused: string };

/**
 * A port's text as a TCP port, or `undefined` when it is not one.
 *
 * @param text the digits
 * @returns the port
 */
function portOf({ text }: { text: string }): number | undefined {
  if (!/^[0-9]{1,5}$/u.test(text)) {
    return undefined;
  }
  const port = Number(text);
  if (port < 1 || port > 65_535) {
    return undefined;
  }
  return port;
}

/**
 * The console-origin flags for this server. Pure.
 *
 * @param listenPort `PORT` as the server's environment holds it, the port it listens on, `undefined` when unset
 * @param root the checkout the server is serving, or `undefined` when it could not be found
 * @param cwd the server's working directory, its checkout's `site/` package root
 * @param docsSitePort `DOCS_SITE_PORT` as the server's environment holds it, `undefined` when unset
 * @returns the flags, or why they could not be derived — never a guessed value
 */
export function consoleOriginArgv({
  listenPort,
  root,
  cwd,
  docsSitePort,
}: {
  listenPort: string | undefined;
  root: string | undefined;
  cwd: string;
  docsSitePort: string | undefined;
}): ConsoleOriginArgv {
  if (root === undefined) {
    return { refused: "the checkout serving this console could not be found, so where it serves from is unknown" };
  }
  // The root is the checkout the server RUNS in, never an ancestor's: a clone nested inside the owner's checkout with no
  // `bin/slopweaver` of its own would otherwise be stamped as the owner's.
  if (resolve(root) !== dirname(resolve(cwd))) {
    return { refused: `the slopweaver found at ${root} is not the checkout this server runs in (${cwd})` };
  }
  if (listenPort === undefined) {
    return { refused: "PORT is unset, so the port this server listens on is unknown" };
  }
  const port = portOf({ text: listenPort });
  if (port === undefined) {
    return { refused: `PORT is ${listenPort}, which is not a port` };
  }
  let defaultPort = CONSOLE_DEFAULT_PORT;
  if (docsSitePort !== undefined) {
    const named = portOf({ text: docsSitePort });
    if (named === undefined) {
      return { refused: `DOCS_SITE_PORT is ${docsSitePort}, which is not a port` };
    }
    defaultPort = named;
  }
  return {
    argv: ["--console-root", root, "--console-port", String(port), "--console-default-port", String(defaultPort)],
  };
}

/**
 * The console-origin flags for this server, read off its own working directory and environment, never off a request.
 *
 * @returns the flags, or why they could not be derived
 */
export function originArgvOfServer(): ConsoleOriginArgv {
  const bin = slopweaverBin();
  let root: string | undefined;
  if (bin.found) {
    root = bin.root;
  }
  return consoleOriginArgv({
    cwd: process.cwd(),
    docsSitePort: process.env["DOCS_SITE_PORT"],
    listenPort: process.env["PORT"],
    root,
  });
}

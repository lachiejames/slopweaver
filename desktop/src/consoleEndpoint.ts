/**
 * Where the console is, read off what `scripts/docs-site.sh` printed — the script owns the server and its run
 * record, so the shell never guesses a port. Pure: the effectful half is `consoleServer.ts`.
 */
import { err, ok, type Result } from "neverthrow";

import { type ConsoleError, ConsoleErrors } from "./errors";

/** A console address the script prints: always this machine, always a port. */
const ENDPOINT = /http:\/\/localhost:(\d{1,5})(?![\d])/gu;

/**
 * The one console address in the script's output.
 *
 * `--status` prints `docs-site: http://localhost:3000 — pid …` for a live server and no address at all for a
 * down or absent one; `--start` and `--serve` print the address they serve. Two DIFFERENT addresses is refused
 * rather than one picked, because loading the wrong one would show a stale console with nothing saying so.
 *
 * @param output everything the script printed
 * @returns the origin, `http://localhost:<port>`, or why there is none
 */
export function parseConsoleEndpoint({ output }: { output: string }): Result<string, ConsoleError> {
  const found = new Set<string>();
  for (const match of output.matchAll(ENDPOINT)) {
    const port = Number(match[1]);
    if (port > 0 && port <= 65_535) {
      found.add(`http://localhost:${String(port)}`);
    }
  }
  const endpoints = [...found];
  const only = endpoints[0];
  if (only === undefined) {
    return err(ConsoleErrors.noEndpoint({ output }));
  }
  if (endpoints.length > 1) {
    return err(ConsoleErrors.conflictingEndpoints({ endpoints }));
  }
  return ok(only);
}

/**
 * The checkout named by `--checkout <path>` or `--checkout=<path>` on the command line.
 *
 * @param argv the process's arguments
 * @returns the path, or `undefined` when none was passed
 */
export function checkoutArgument({ argv }: { argv: readonly string[] }): string | undefined {
  for (const [index, arg] of argv.entries()) {
    if (arg.startsWith("--checkout=")) {
      return arg.slice("--checkout=".length);
    }
    if (arg === "--checkout") {
      return argv[index + 1];
    }
  }
  return undefined;
}

/**
 * The PATH the console script runs under. An app opened from Finder gets launchd's bare PATH, which carries
 * neither the pinned node nor yarn, so
 * proto's shims lead, Homebrew follows, then whatever the shell was given, and the system directories close it.
 *
 * @param home the user's home directory
 * @param inherited the PATH this process was given; launchd may give none at all
 * @returns the PATH to run the script under
 */
export function childPathEnv({ home, inherited }: { home: string; inherited: string | undefined }): string {
  const lead = [`${home}/.proto/shims`, `${home}/.proto/bin`, "/opt/homebrew/bin", "/usr/local/bin"];
  const system = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  if (inherited === undefined) {
    return [...lead, ...system].join(":");
  }
  const rest = inherited
    .split(":")
    .filter((entry) => entry.length > 0 && !lead.includes(entry) && !system.includes(entry));
  return [...lead, ...rest, ...system].join(":");
}

/**
 * The whole environment a child of this shell runs under: {@link childPathEnv}'s PATH, and no `CMUX_*` key. The
 * shell is outside cmux by construction, but `/usr/bin/open` hands the app its caller's environment, so an app
 * reopened by `desktop update` from a seat carried that seat's `CMUX_WORKSPACE_ID` — and every `cmux revive` it ran
 * refused as inside cmux, every minute (measured: the journal was never written).
 *
 * @param home the user's home directory
 * @param inherited the environment this process was given
 * @returns the environment to run a child under
 */
export function childEnv({
  home,
  inherited,
}: {
  home: string;
  inherited: Readonly<Record<string, string | undefined>>;
}): Record<string, string | undefined> {
  const kept = Object.entries(inherited).filter(([key]) => !key.startsWith("CMUX_"));
  return { ...Object.fromEntries(kept), PATH: childPathEnv({ home, inherited: inherited["PATH"] }) };
}

/**
 * Drop every `CMUX_*` key from this process's own environment, at startup, so no child it starts inherits one —
 * Electron's renderer and helper processes included, which no `env` option reaches.
 *
 * @param env the environment to scrub in place, `process.env` in the app
 */
export function dropCmuxEnv({ env }: { env: Record<string, string | undefined> }): void {
  for (const key of Object.keys(env).filter((name) => name.startsWith("CMUX_"))) {
    Reflect.deleteProperty(env, key);
  }
}

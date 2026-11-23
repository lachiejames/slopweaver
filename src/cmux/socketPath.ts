/**
 * Where the cmux control socket lives, resolved the same three ways cmux's own CLI resolves it.
 *
 * Measured on cmux 0.64.22: `CMUX_SOCKET_PATH` is exported into every surface cmux opens, so a Slopweaver
 * process running INSIDE a cmux workspace always has it. A process started outside one (a plain terminal, a
 * scheduled run) does not, and falls back to the `last-socket-path` pointer file cmux keeps beside the
 * socket, then to the default path. The deprecated `CMUX_SOCKET` alias is deliberately NOT consulted: cmux
 * exports it EMPTY inside a workspace, so trusting it would resolve to `""` in exactly the environment the
 * socket is most certainly present in.
 *
 * A named path that does not exist is skipped for the next one that does. OBSERVED, cause PLAUSIBLE and
 * not proven: the cmux 0.65.2 update renamed the socket from `cmux-501.sock` to `cmux.sock` (`~/.local/state/cmux/`
 * kept the old lock file beside the new socket and pointer), and the console voice's `cmux list` failed on a socket
 * path that did not exist while a command run inside the new cmux worked — consistent with a process still holding
 * the old path (an exported `CMUX_SOCKET_PATH` from before the update, or a pointer not yet rewritten), though which
 * source it read was not captured. The order is unchanged; only a candidate that EXISTS is taken, and when none does
 * the first named is returned so the connection failure still names the path that was expected. Existence is a file
 * check, never proof that cmux listens there: a stale socket inode still wins, and the capability a process inherited
 * for the old socket is presented to the new one unverified.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Reading the pointer file is injected so resolution stays testable without writing to a real home. */
export interface SocketPathSources {
  /**
   * The process environment to read `CMUX_SOCKET_PATH` from.
   */
  readonly env: Readonly<Record<string, string | undefined>>;
  /**
   * Read a file's trimmed contents, or `undefined` when it does not exist / cannot be read.
   */
  readonly readTextFile: (options: { path: string }) => string | undefined;
  /**
   * The OS user's home directory (NOT `$SLOPWEAVER_HOME` — cmux's own state lives under the real home),
   * injected so a test never depends on the machine it runs on.
   */
  readonly userHome: string;
  /**
   * Whether a path exists on disk. Absent, every candidate is taken as existing and the first named wins, which is
   * what a resolution with nothing to check against has to do.
   */
  readonly exists?: (options: { path: string }) => boolean;
}

/**
 * Where cmux keeps its pointer file and its default socket, relative to a home directory.
 *
 * @param userHome the OS user's home directory to resolve against
 * @returns the pointer-file path and the default socket path
 */
export function cmuxStatePaths({ userHome }: { userHome: string }): {
  readonly pointerFile: string;
  readonly defaultSocket: string;
} {
  const stateDir = join(userHome, ".local", "state", "cmux");
  return { defaultSocket: join(stateDir, "cmux.sock"), pointerFile: join(stateDir, "last-socket-path") };
}

/**
 * Every path the sources NAME, in order: the environment, then cmux's own pointer file. A blank is not named, and the
 * default is not here — it is what a caller falls back to when nothing named exists.
 *
 * @param sources the environment, home directory and file reader to resolve through
 * @param pointerFile cmux's own pointer file
 * @returns the named candidates, possibly none
 */
function namedSocketCandidates({
  sources,
  pointerFile,
}: {
  sources: SocketPathSources;
  pointerFile: string;
}): readonly string[] {
  const named = [sources.env["CMUX_SOCKET_PATH"], sources.readTextFile({ path: pointerFile })];
  const out: string[] = [];
  for (const candidate of named) {
    const trimmed = candidate?.trim();
    if (trimmed !== undefined && trimmed.length > 0) {
      out.push(trimmed);
    }
  }
  return out;
}

/**
 * Resolve the socket path: the environment first, then cmux's own pointer file, then the default — the first of
 * those that exists when the sources can say, else the first named, else the default.
 *
 * @param sources the environment, home directory and file reader to resolve through
 * @returns the resolved socket path — always a path, never a claim that anything is listening on it
 */
export function resolveCmuxSocketPath({ sources }: { sources: SocketPathSources }): string {
  const paths = cmuxStatePaths({ userHome: sources.userHome });
  const named = namedSocketCandidates({ pointerFile: paths.pointerFile, sources });
  const exists = sources.exists;
  if (exists !== undefined) {
    const existing = [...named, paths.defaultSocket].find((path) => exists({ path }));
    if (existing !== undefined) {
      return existing;
    }
  }
  const [first] = named;
  if (first === undefined) {
    return paths.defaultSocket;
  }
  return first;
}

/** Where to connect, and the capability token to present there (`undefined` presents none). */
export interface CmuxSocketEndpoint {
  readonly socketPath: string;
  readonly capability: string | undefined;
}

/**
 * The endpoint a connection uses: the LIVE one when no socket is named, or exactly what the caller named.
 *
 * cmux exports `CMUX_SOCKET_CAPABILITY` into every surface it opens and a child inherits it even after it is
 * reparented away from cmux, which is the one case the token exists for (`socketFrames.ts`'s
 * `encodeRequest`); a process started outside cmux has none and is refused under `cmuxOnly`. The token
 * belongs to the live socket only: a caller naming its own socket (a test's fake server) presents a token
 * only if it passes one, so a test run inside cmux never hands the developer's real token to a fake.
 *
 * @param socketPath the socket the caller named, or `undefined` for the live one
 * @param capability the token the caller named; read from the environment only for the live socket
 * @param sources the environment, home directory and file reader to resolve the live endpoint through
 * @returns the endpoint — never a claim that anything is listening on it
 */
export function resolveCmuxSocketEndpoint({
  socketPath,
  capability,
  sources,
}: {
  socketPath: string | undefined;
  capability: string | undefined;
  sources: SocketPathSources;
}): CmuxSocketEndpoint {
  if (socketPath !== undefined) {
    return { capability, socketPath };
  }
  const token = sources.env["CMUX_SOCKET_CAPABILITY"];
  let live: string | undefined;
  if (token !== undefined && token.trim().length > 0) {
    live = token.trim();
  }
  return { capability: live, socketPath: resolveCmuxSocketPath({ sources }) };
}

/**
 * The production {@link SocketPathSources} — the real environment, the real home, a real file read.
 *
 * @returns the sources to resolve the live socket path through
 */
export function productionSocketPathSources(): SocketPathSources {
  return {
    env: process.env,
    exists: ({ path }) => existsSync(path),
    userHome: homedir(),
    readTextFile: ({ path }) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    },
  };
}

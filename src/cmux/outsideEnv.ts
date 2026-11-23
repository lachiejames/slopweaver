/**
 * The environment a process launched for OUTSIDE any seat runs under: the caller's, with every key a seat set for its
 * own process tree removed, so the app reads as launched from the Dock.
 *
 * `/usr/bin/open` hands the app it launches its caller's environment. MEASURED: `desktop update` run from
 * a seat reopened the desktop app carrying that seat's `CMUX_WORKSPACE_ID`, `CMUX_SOCKET_PATH` and seven
 * more, so every `cmux revive` it ran refused as inside cmux and no reading was journalled for fourteen minutes
 * (`supervisor-scratch/handoff-<n>/evidence/desktop-update-from-a-cmux-seat-defeats-cmux-revive.md`).
 *
 * The same hand-down carries the seat's own session. MEASURED: `desktop install` run from a Claude Code
 * seat opened the app carrying that seat's `CLAUDE_CODE_SESSION_ID`, its messaging token and socket, and its plan's
 * `CLAUDE_SECURESTORAGE_CONFIG_DIR`; an app-hosted Codex session then ran under all of them, so a `claude` it started
 * spent the installing seat's plan, its tools held that seat's messaging token, and with its own `CODEX_THREAD_ID`
 * beside a Claude session id no hatch grant could name it (`hatch/grantSession.ts`). Repro, with the app's pid from
 * `pgrep -f 'Slopweaver.app/Contents/MacOS/Slopweaver --checkout'`: `ps -E -ww -o command= -p <pid> | tr ' ' '\n' |
 * grep -c '^CLAUDE'` — fourteen on that app.
 *
 * Both vendors' namespaces are therefore dropped WHOLE, because a seat exports keys no list keeps up with: a name list
 * measured on one seat missed `CLAUDE_CODE_SESSION_ACCESS_TOKEN`, and a Codex pass's shell carried `CODEX_CI`,
 * `CODEX_VERSION` and `CODEX_INTERNAL_ORIGINATOR_OVERRIDE` beside its session and thread ids. A Dock launch carries
 * none of either, so the one key kept is the owner's configuration the app itself reads (`CLAUDE_CONFIG_DIR`,
 * `desktop/src/fleetShell.ts`); a session the app hosts reads the owner's settings files for the rest. The keys a seat
 * exports outside both namespaces are named below.
 */
import { NX_DAEMON_OFF_PREFIX } from "./fleetEnv.js";

/**
 * Namespaces only a seat writes, on the app's launch: cmux's own, everything Claude Code exports (`CLAUDECODE`
 * included), and everything a Codex process exports, its credentials and routed `CODEX_HOME` included.
 */
const SEAT_KEY_PREFIXES: readonly string[] = Object.freeze(["CMUX_", "CLAUDE", "CODEX_"]);

/** The owner's own configuration inside a dropped namespace, which the app reads. */
const OWNER_KEYS: ReadonlySet<string> = new Set(["CLAUDE_CONFIG_DIR"]);

/**
 * The keys a seat exports outside those namespaces: Claude Code's agent marker and trace context, which `env | cut
 * -d= -f1` in a seat finds, and the credentials either vendor reads in preference to a routed login.
 */
const UNPREFIXED_SEAT_KEYS: readonly string[] = Object.freeze([
  "AI_AGENT",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "TRACEPARENT",
]);

/**
 * Electron's switch to start Node instead of an app. A Codex pass's shell sets it (`codex/electronSurface.ts`), and so
 * does the app for every session worker it hosts; an app opened under it never starts as an app at all.
 */
const ELECTRON_AS_NODE_KEY = "ELECTRON_RUN_AS_NODE";

/** The key a fleet worktree seat's boot line exports, read off the very prefix that line carries. */
const FLEET_BOOT_KEY = NX_DAEMON_OFF_PREFIX.slice(0, NX_DAEMON_OFF_PREFIX.indexOf("="));

const SEAT_KEYS: ReadonlySet<string> = new Set([ELECTRON_AS_NODE_KEY, FLEET_BOOT_KEY, ...UNPREFIXED_SEAT_KEYS]);

function isSeatKey({ key }: { key: string }): boolean {
  if (OWNER_KEYS.has(key)) {
    return false;
  }
  return SEAT_KEYS.has(key) || SEAT_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Drop every key a seat set for its own process tree, keeping the rest as given.
 *
 * @param env the caller's environment
 * @returns the environment for a process that must read as launched outside any seat
 */
export function withoutSeatEnv({
  env,
}: {
  env: Readonly<Record<string, string | undefined>>;
}): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !isSeatKey({ key })));
}

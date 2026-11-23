/**
 * Running ONE command of the `playwright-core` terminal client against a NAMED session in the owner's own
 * Chrome — the shell every interaction verb dispatches through.
 *
 * ## It leans on the client rather than re-implementing it
 *
 * `playwright-core` already ships `click`, `dblclick`, `fill`, `type`, `select`, `check`, `uncheck`,
 * `hover`, `press`, `drag`, `upload`, `snapshot`, `screenshot`, `go-back`, `go-forward`, `reload`,
 * `dialog-accept`, `dialog-dismiss`, `tab-close` and `detach` as first-class commands, each of which owns
 * actionability waiting, locator generation from an accessibility ref, and file-chooser handling. Enumerate
 * them from `playwright-core/lib/tools/cli-client/help.json`. Writing a second copy of any of those would be
 * a worse copy of a thing already installed, which is the preference `docs/provider-sdks.md` states for a
 * provider SDK and which applies here for the same reason.
 *
 * ## The data channel is ARGV, not source
 *
 * A selector, a ref, typed text and a file path are each ONE argv element handed to `execFileSync` — never
 * spliced into a shell string, never interpolated into JavaScript, never used to choose a method name. The
 * command is picked from a closed list in `./action.ts` before anything reaches here. So the worst a page
 * can do to this module is name an element that does not exist, which the client answers with an error.
 *
 * `execFileSync` rather than an async spawn for the same reason `./playwrightCli.ts` gives: `no-headless` in
 * `yarn lint` bans every asynchronous child-process capability, AGENTS.md rule 2, and nothing is lost
 * because one interaction at a time is the whole shape of the thing.
 *
 * ## Typed text does reach argv, and that is a stated limit
 *
 * A `fill` puts its text on a command line, where a process listing on this machine can see it. That is fine
 * for a search box and wrong for a password, so the verb refuses to carry a secret and says so rather than
 * pretending argv is private. A credential belongs in the page's own password manager, which is the owner's, and
 * this lane never needed to know one.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { errorMessage } from "../lib/errorMessage.js";
import { err, ok, type Result } from "../lib/result.js";
import { type BrowserActionError, BrowserActionErrors } from "./actionErrors.js";
import type { WindowPlacement } from "./foreground.js";

/**
 * How long one client command may take before it is killed.
 *
 * @internal
 *
 * Generously above the measured cost of an interaction (about a second once a session is attached, against
 * roughly four for the first attach), and well under the two minutes `./playwrightCli.ts` allows a whole
 * page visit — an interaction that has not answered in this long is wedged rather than slow.
 */
export const CLIENT_COMMAND_TIMEOUT_MS = 60_000;

/**
 * The most one client command may print before it is treated as runaway output.
 *
 * @internal
 */
export const MAX_CLIENT_OUTPUT_BYTES = 16 * 1_048_576;

/** What the client needs to reach the owner's browser. */
export interface TerminalClientDeps {
  /** The shim Chrome is launched through, so a connect page opens in the recorded work profile. */
  readonly chromePinPath: string;
  /** The owner's own extension consent secret, passed through the environment and never argv. */
  readonly extensionToken: string;
  /** The private directory the client runs in, which is what keys its own session registry. */
  readonly workspace: string;
  /** The session name the client knows this run by. */
  readonly clientSession: string;
  /**
   * How long one command may take, when a caller holds a budget tighter than {@link CLIENT_COMMAND_TIMEOUT_MS}:
   * `browser inspect` runs inside the console voice's tool deadline and has to leave time to close its tab.
   */
  readonly commandTimeoutMs?: number;
  /**
   * Taken before every command and released when it ends, refusing the command when the answer is an error. An
   * acting verb claims its session this way — the session's lock held for the whole command, the record touched
   * inside it — so no closer can act while a command runs through the tab, and no run of commands reads as idle
   * to `machine reap` however long it takes — `keptAliveDeps` in
   * `../cli/commands/browser/sessionHold.ts`. Absent on a closer, which holds the lock itself.
   */
  readonly holdForCommand?: () => Result<() => void, BrowserActionError>;
  /** Where the session's window belongs whenever a command brings it forward — `./keepForeground.ts`. */
  readonly placement: WindowPlacement;
}

/** What one client command produced. */
export interface TerminalReply {
  /** Everything the client printed, as it printed it. */
  readonly stdout: string;
  /** The page's URL, when the reply named one. */
  readonly pageUrl: string | null;
  /** The page's title, when the reply named one. */
  readonly pageTitle: string | null;
  /** The snapshot file the client wrote, when it wrote one. */
  readonly snapshotPath: string | null;
  /**
   * The accessibility snapshot the client printed INLINE, when it printed one.
   *
   * The `snapshot` command renders its YAML into a fenced block rather than naming a file —
   * MEASURED — while `goto` and every interaction name a file instead. Both are carried, and the caller
   * takes whichever it was given, because an `elements:` line pointing at a path the client never wrote is
   * the sort of confident lie a reader has no way to catch.
   */
  readonly snapshotYaml: string | null;
  /** Set when the page raised a modal the client is waiting on. */
  readonly modalState: string | null;
}

/**
 * Write the client shim into a session's workspace.
 *
 * `playwright-core` publishes `./lib/tools/cli-client/program` in its `exports` map, so this is a supported
 * entry point rather than a reach into internals. The module path is RESOLVED here rather than written as a
 * bare specifier, because the shim runs from a directory outside the repository and CommonJS resolution
 * walks up from the FILE — a bare specifier there fails with `MODULE_NOT_FOUND`.
 *
 * The `.playwright` marker beside it is what makes the client treat this directory as its workspace root,
 * which is what keys the session registry. Without it the client walks up to whatever ancestor happens to
 * carry one, and two sessions from two worktrees would silently share a registry.
 *
 * @param workspace the private directory this session runs in
 * @returns the shim's path, or why it could not be written
 */
export function prepareClientWorkspace({ workspace }: { workspace: string }): Result<string, BrowserActionError> {
  try {
    mkdirSync(join(workspace, ".playwright"), { recursive: true });
    const resolved = createRequire(import.meta.url).resolve("playwright-core/lib/tools/cli-client/program");
    const shim = join(workspace, "client.cjs");
    writeFileSync(
      shim,
      `const { program } = require(${JSON.stringify(resolved)});\nprogram(["node", "playwright-cli", ...process.argv.slice(2)]);\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    return ok(shim);
  } catch (error: unknown) {
    return err(
      BrowserActionErrors.clientFailed({
        detail: `the client shim could not be written into ${workspace}: ${errorMessage({ error })}`,
      }),
    );
  }
}

/**
 * Read one named section out of the client's own markdown reply.
 *
 * The client's structured `--json` mode is much thinner than its default output — MEASURED, a
 * successful command answers `{"snapshot":{"file":"..."}}` and nothing about the page — so the URL, the
 * title and the modal state have to come from the default rendering. These are FIXED headings the client
 * emits, not a format a page influences.
 *
 * @param stdout everything the client printed
 * @param label the bullet's label, as the client spells it
 * @returns the value, or `null` when the reply carried no such line
 */
function bulletValue({ stdout, label }: { stdout: string; label: string }): string | null {
  for (const line of stdout.split("\n")) {
    const prefix = `- ${label}: `;
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length).trim();
    }
  }
  return null;
}

/**
 * Read the snapshot path out of the client's reply.
 *
 * @param stdout everything the client printed
 * @returns the path, or `null` when the reply named none
 */
function snapshotPathOf({ stdout }: { stdout: string }): string | null {
  const matched = /^- \[Snapshot\]\((?<path>[^)]+)\)/mu.exec(stdout);
  const path = matched?.groups?.["path"];
  if (path === undefined) {
    return null;
  }
  return path;
}

/**
 * Read the accessibility snapshot the client printed inline, when it printed one.
 *
 * @param stdout everything the client printed
 * @returns the YAML, or `null` when the reply carried none
 */
function snapshotYamlOf({ stdout }: { stdout: string }): string | null {
  const matched = /^### Snapshot\n```yaml\n(?<body>[\s\S]*?)\n```/mu.exec(stdout);
  const body = matched?.groups?.["body"];
  if (body === undefined) {
    return null;
  }
  return body;
}

/**
 * Whether the reply says the page is holding a modal open.
 *
 * @param stdout everything the client printed
 * @returns the modal's description, or `null` when there is none
 */
function modalStateOf({ stdout }: { stdout: string }): string | null {
  const matched = /^### Modal state\n(?<body>- .*)$/mu.exec(stdout);
  const body = matched?.groups?.["body"];
  if (body === undefined) {
    return null;
  }
  return body.trim();
}

/**
 * How long one client command may run before it is killed: the cap this one call names, else the caller's per-command
 * cap, else the client's own minute. Pure.
 *
 * ## Why an attach names its own cap rather than sharing a tight one
 *
 * Killing an attach mid-connect is what puts "Failed to connect to MCP relay: WebSocket error" on the owner's screen. An
 * `attach --extension` starts a detached daemon whose relay server hosts the WebSocket the extension's connect page
 * dials, and `playwright-core` itself waits up to 30 s for the extension (`extensionConnectionTimeout`,
 * `lib/coreBundle.js`). The client forwards a SIGTERM to that daemon while it is still starting
 * (`lib/tools/cli-client/session.js`, `startDaemon`), so a kill on this side takes the relay down and leaves the
 * connect page dialling nothing. MEASURED: every voice `browser present` that died with
 * `spawnSync … ETIMEDOUT` died on the attach under the 6 s per-command cap, and one left exactly that page in
 * front of the owner. Repro: `grep -o '"atIso":"[^"]*","detail":"slopweaver browser [a-z]* --json
 * exited 1 — the browser client failed while performing this: spawnSync' "$SLOPWEAVER_HOME"/talk/calls/*.jsonl`.
 *
 * So the attach call site passes `ATTACH_TIMEOUT_MS` (`./lookBudget.ts`) as its own `timeoutMs`, explicitly, rather
 * than this module recognising an attach by its argv.
 *
 * @param timeoutMs the cap this one call names, when it names one
 * @param deps the per-command cap the caller set, if any
 * @returns the cap in milliseconds
 */
export function commandTimeoutFor({
  timeoutMs,
  deps,
}: {
  timeoutMs: number | undefined;
  deps: Pick<TerminalClientDeps, "commandTimeoutMs">;
}): number {
  if (timeoutMs !== undefined) {
    return timeoutMs;
  }
  if (deps.commandTimeoutMs !== undefined) {
    return deps.commandTimeoutMs;
  }
  return CLIENT_COMMAND_TIMEOUT_MS;
}

/**
 * Run one client command against a named session.
 *
 * @param args the command and its arguments, each already one argv element
 * @param deps the browser the client reaches and the session it reaches it under
 * @param mayAct whether this command could change the page, so a failure can say the outcome is UNKNOWN
 *   rather than reporting it as nothing having happened
 * @param timeoutMs this one call's own cap over the caller's per-command one — the attach's, `ATTACH_TIMEOUT_MS`
 * @returns what the client said, or the typed failure
 */
export function runClientCommand({
  args,
  deps,
  mayAct = false,
  timeoutMs,
}: {
  args: readonly string[];
  deps: TerminalClientDeps;
  mayAct?: boolean;
  timeoutMs?: number | undefined;
}): Result<TerminalReply, BrowserActionError> {
  if (deps.holdForCommand === undefined) {
    return runUnheld({ args, deps, mayAct, timeoutMs });
  }
  const held = deps.holdForCommand();
  if (held.isErr()) {
    return err(held.error);
  }
  try {
    return runUnheld({ args, deps, mayAct, timeoutMs });
  } finally {
    held.value();
  }
}

/** {@link runClientCommand}'s body, run once whatever hold the caller's deps take has been taken. */
function runUnheld({
  args,
  deps,
  mayAct,
  timeoutMs,
}: {
  args: readonly string[];
  deps: TerminalClientDeps;
  mayAct: boolean;
  timeoutMs: number | undefined;
}): Result<TerminalReply, BrowserActionError> {
  const shim = join(deps.workspace, "client.cjs");
  const commandTimeoutMs = commandTimeoutFor({ deps, timeoutMs });
  let stdout: string;
  try {
    stdout = execFileSync(process.execPath, [shim, `-s=${deps.clientSession}`, ...args], {
      cwd: deps.workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        PLAYWRIGHT_MCP_EXECUTABLE_PATH: deps.chromePinPath,
        PLAYWRIGHT_MCP_EXTENSION_TOKEN: deps.extensionToken,
      },
      maxBuffer: MAX_CLIENT_OUTPUT_BYTES,
      timeout: commandTimeoutMs,
    });
  } catch (error: unknown) {
    return err(BrowserActionErrors.clientFailed({ detail: clientErrorDetail({ error }), mayHaveReachedPage: mayAct }));
  }
  if (stdout.includes("### Error")) {
    return err(
      BrowserActionErrors.clientFailed({
        detail: stdout.slice(stdout.indexOf("### Error")).trim(),
        mayHaveReachedPage: mayAct,
      }),
    );
  }
  return ok({
    modalState: modalStateOf({ stdout }),
    pageTitle: bulletValue({ label: "Page Title", stdout }),
    pageUrl: bulletValue({ label: "Page URL", stdout }),
    snapshotPath: snapshotPathOf({ stdout }),
    snapshotYaml: snapshotYamlOf({ stdout }),
    stdout,
  });
}

/**
 * What a thrown client failure actually said.
 *
 * The client prints its own `### Error` block to stdout and then exits non-zero, so the useful half of a
 * throw is the captured output rather than the exception's own message — which is only ever
 * "Command failed". Reading stdout first is why a refusal here names the ref that was not found instead of
 * naming node.
 *
 * @param error whatever was thrown
 * @returns the detail to carry on the typed failure
 */
function clientErrorDetail({ error }: { error: unknown }): string {
  if (error !== null && typeof error === "object" && "stdout" in error) {
    const printed = (error as { stdout?: unknown }).stdout;
    const text = typeof printed === "string" ? printed.trim() : "";
    if (text.length > 0) {
      return text;
    }
  }
  return errorMessage({ error });
}

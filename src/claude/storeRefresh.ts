/**
 * The two effects an on-demand credential repair needs: read one store's own lifetime metadata, and run the
 * CLI's own OAuth refresh under it. Everything either of them DECIDES was decided in `credentialRepair.ts`,
 * which is pure; this file does the keychain read and the one child process, through `execFileSync` only, so
 * nothing here can outlive the gate that called it.
 *
 * It lives in `src/claude/` rather than under a CLI verb because the pre-spawn gate reaches it — the same
 * reason `spawnStore.ts` is here. These two functions once sat inside
 * `src/cli/commands/claude/watchRefresh.ts`, where a core module cannot import them.
 *
 * Nothing here returns, copies or logs a credential. The store is selected by an ENVIRONMENT VARIABLE and
 * nothing else, and the metadata read is bounded by `credentialDocument.ts`'s four narrow readers, whose
 * return types are two instants and two booleans.
 */
import { execFileSync } from "node:child_process";

import type { ClaudeAccount } from "./contracts.js";
import {
  credentialExpiryIso,
  credentialHasAccessToken,
  credentialHasRefreshToken,
  credentialRefreshExpiryIso,
  readClaudeCredential,
} from "./credentialDocument.js";
import type { StoreLife } from "./credentialRepair.js";
import { readCredentialDocument } from "./keychain.js";

/** The CLI whose own refresh keeps a store alive. Named here so nothing builds a shell line out of it. */
const REFRESH_BINARY = "claude";

/**
 * The model-free command that reaches the CLI's OAuth refresh.
 *
 * MEASURED on Claude Code 2.1.268, each run under an EXPIRED store: `doctor` run from an empty
 * directory exited 0 in about a second and moved neither the keychain `mdat` nor the expiry, and `auth status`
 * did the same — yet the standing watch's own `doctor`, run from the slopweaver checkout, refreshed an expired
 * plan-four. A command whose reach depends on the directory it happens to run in is no primitive
 * to build on. `mcp list` reached it from an empty directory and moved the `mdat`, but it also health-checks
 * every configured MCP server and wrote an `mcpOAuth` sibling into the store. `--safe-mode` keeps it to the
 * refresh: it reached it in 1.6 s and added no sibling. Reproduce by reading a store's keychain `mdat` and
 * `expiresAt` either side of the command, run from inside that store's directory.
 *
 * That measurement is against **2.1.268**; the binary on this machine has since auto-updated, and the
 * reproduction above is what re-establishes it rather than this comment. It starts no model and is not a
 * headless session (doctrine rule 2): it is a subscription refresh, which is why `--safe-mode` mattering at
 * all is worth keeping in view.
 */
const REFRESH_ARGS: readonly string[] = ["--safe-mode", "mcp", "list"];

/**
 * How long one refresh may take before it is abandoned and reported.
 *
 * @internal — the number `spawnStore.ts`'s latency budget is computed from; a test reads it through
 *   {@link storeRefreshInvocation}, which is the value production actually passes.
 */
const REFRESH_TIMEOUT_MS = 60_000;

/** The one complaint a failed refresh command makes — constant, so no caught exception reaches a log. */
export const REFRESH_COMMAND_PROBLEM = "the refresh command did not complete";

/** The subprocess seam, so a unit test can assert what would be run without running it. */
export interface StoreRefreshRunner {
  (options: { args: readonly string[]; binary: string; storeDir: string; timeoutMs: number }): void;
}

/** Exactly what the real subprocess is handed. Pure, so a test pins the REAL call rather than a fake's echo. */
export interface StoreRefreshInvocation {
  readonly binary: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdio: "ignore";
  readonly timeout: number;
}

/**
 * The exact invocation {@link runStoreRefresh} makes, as a value.
 *
 * It exists because the injected-runner test could not see the thing that matters: delete `cwd` and the store override from the real call and every assertion still passes,
 * because the fake runner never reaches it. The working directory and the override are the two load-bearing
 * parts of this primitive — `doctor` run from the wrong directory refreshed nothing — so they
 * have to be assertable on the real path, not on a recording of its arguments.
 *
 * @param env the ambient environment the child inherits, with the store override added on top
 * @param storeDir the store, used as BOTH the working directory and the credential override
 * @returns the whole invocation, ready to hand to `execFileSync`
 */
export function storeRefreshInvocation({
  env,
  storeDir,
}: {
  env: Readonly<Record<string, string | undefined>>;
  storeDir: string;
}): StoreRefreshInvocation {
  return {
    args: REFRESH_ARGS,
    binary: REFRESH_BINARY,
    cwd: storeDir,
    env: { ...env, CLAUDE_SECURESTORAGE_CONFIG_DIR: storeDir },
    stdio: "ignore",
    timeout: REFRESH_TIMEOUT_MS,
  };
}

/**
 * Run the CLI's own refresh under one store.
 *
 * The store is selected by an ENVIRONMENT VARIABLE and nothing else, so no credential is read, copied or held
 * here — the same mechanism `seatPinning.ts` uses to boot a pinned session. It runs from INSIDE the store's
 * directory, which the fleet owns and keeps empty, so no project's MCP configuration is in reach even before
 * `--safe-mode` excludes it. No Slopweaver credential lock is taken around it: the CLI takes its own for the
 * refresh write, and holding one here would make it wait on us.
 *
 * Whether the command exiting cleanly achieved anything is NOT decided here — the caller reads the store's
 * expiry either side of it, which is the only witness that ever held (`credentialRepair.ts` § Why an attempt
 * is judged by the EXPIRY).
 *
 * @param run the subprocess seam, defaulting to the real one — injected only by tests
 * @param storeDir the credential store to refresh
 * @returns undefined when the command completed, or the reason it did not
 */
export function runStoreRefresh({
  run = execStoreRefresh,
  storeDir,
}: {
  run?: StoreRefreshRunner;
  storeDir: string;
}): string | undefined {
  const runner = run;
  try {
    runner({ args: REFRESH_ARGS, binary: REFRESH_BINARY, storeDir, timeoutMs: REFRESH_TIMEOUT_MS });
    return undefined;
  } catch {
    return REFRESH_COMMAND_PROBLEM;
  }
}

/**
 * The real subprocess. Every value it passes comes from {@link storeRefreshInvocation}, so the call a test pins
 * and the call production makes are the same object.
 *
 * @param storeDir the store to refresh
 */
function execStoreRefresh({ storeDir }: { storeDir: string }): void {
  const invocation = storeRefreshInvocation({ env: process.env, storeDir });
  execFileSync(invocation.binary, invocation.args, {
    cwd: invocation.cwd,
    env: invocation.env,
    stdio: invocation.stdio,
    timeout: invocation.timeout,
  });
}

/** The keychain seam, so a unit test can supply a document without reaching the real keychain. */
export interface CredentialDocumentReader {
  (options: { storeDir: string }): unknown;
}

/**
 * How much life one store's own credential has left, read out of its keychain item.
 *
 * @param account the plan whose store to read
 * @param read the keychain seam, defaulting to the real one — injected only by tests
 * @returns the store's reading — never a token, only two instants and three booleans
 */
export function readStoreLife({
  account,
  read = readCredentialDocument,
}: {
  account: ClaudeAccount;
  read?: CredentialDocumentReader;
}): StoreLife {
  const reader = read;
  const document = reader({ storeDir: account.storeDir });
  if (document === undefined) {
    // The item could not be read: a locked keychain, a timeout, `security` briefly unavailable, or genuinely
    // no item at all. That is NOT established to be a store holding nothing, and the difference matters —
    // one sends the owner to a browser sign-in. The reader collapses absence and failure, so this is
    // deliberately the conservative reading of both.
    return { alias: account.alias, hasCredential: false, hasRefreshToken: false, unreadable: true };
  }
  const slice = readClaudeCredential({ document });
  const expiresAtIso = credentialExpiryIso({ slice });
  const refreshExpiresAtIso = credentialRefreshExpiryIso({ slice });
  return {
    alias: account.alias,
    hasCredential: credentialHasAccessToken({ slice }),
    hasRefreshToken: credentialHasRefreshToken({ slice }),
    ...(expiresAtIso === undefined ? {} : { expiresAtIso }),
    ...(refreshExpiresAtIso === undefined ? {} : { refreshExpiresAtIso }),
  };
}

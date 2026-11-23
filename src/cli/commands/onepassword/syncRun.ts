/**
 * `slopweaver onepassword sync [--since <iso>] [--json] [--home <dir>]` — build the local 1Password ADMIN
 * atlas: users, groups, membership, vaults, who can reach each vault, item COUNTS, integrations and audit
 * activity. A thin shell over `atlas/onepassword/sync.ts`; the domain owns the merge, the gate and the
 * publish.
 *
 * ## Two credentials, and either may be missing
 *
 * The roster comes from an `op` session and the activity feed from an Events API token. This verb probes
 * each independently and hands the domain a `null` runner or a failed credential rather than refusing —
 * a run with one half configured publishes that half and marks the other `not-configured`.
 *
 * ## The exit-code contract
 *
 * | situation                                                                   | code |
 * | --------------------------------------------------------------------------- | ---- |
 * | a bad flag                                                                  | `2`  |
 * | NEITHER credential configured                                               | `3`  |
 * | a hard refusal — lock contention, an untrusted generation, a refused publish | `1`  |
 * | at least one credential configured, but some kind synced incompletely        | `1`  |
 * | every attempted kind synced completely                                       | `0`  |
 */
import {
  resolveOnepasswordAccount,
  resolveOnepasswordEventsCredentials,
} from "../../../atlas/onepassword/credentials.js";
import { createOnepasswordEventsClient } from "../../../atlas/onepassword/eventsClient.js";
import { runOpSurface, signInOpSession } from "../../../atlas/onepassword/opCli.js";
import { resolveOpSessionEnv } from "../../../atlas/onepassword/opSession.js";
import { type OnepasswordSyncReport, syncOnepasswordAtlas } from "../../../atlas/onepassword/sync.js";
import type { OnepasswordProgress, OpSurfaceRunner } from "../../../atlas/onepassword/syncCore.js";
import { onepasswordAtlasPassword, onepasswordEventsToken } from "../../../config.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import {
  exitCodeForOnepasswordSyncReport,
  onepasswordSinceFor,
  onepasswordSyncFailureClosingLine,
  parseOnepasswordSyncOptions,
  renderOnepasswordChannelLines,
  renderOnepasswordTailLines,
} from "./core.js";

/**
 * Exported so a test can assert this equals the manifest's own copy — the manifest cannot import it
 * directly without eagerly loading this module's atlas dependency for every CLI invocation.
 */
export const ONEPASSWORD_SYNC_USAGE = "usage: slopweaver onepassword sync [--since <iso>] [--json] [--home <dir>]";

/**
 * Probe whether there is a usable `op` session, and bind the account to every later call if so.
 *
 * `op whoami` is the cheapest surface in the allowlist and the only one whose failure is unambiguous: it
 * distinguishes "no binary", "not signed in" and "signed in" without touching a vault. Probing here rather
 * than letting the first real call fail means the roster half reports ONE reason instead of six copies of
 * it, one per kind.
 *
 * Which session, and when to sign in from the stored password, is {@link resolveOpSessionEnv}'s decision;
 * this supplies the real `op` calls and the secret read.
 *
 * @param home the Slopweaver home the password secret is read from
 * @returns a runner bound to the resolved account, or why the roster half is unavailable
 */
function probeOpSession({ home }: { home: string }): { runner: OpSurfaceRunner; account: string } | { reason: string } {
  const account = resolveOnepasswordAccount({ env: process.env });
  if (account.isErr()) {
    return { reason: account.error.join("; ") };
  }
  const resolved = resolveOpSessionEnv({
    env: process.env,
    seams: {
      readPassword: () => onepasswordAtlasPassword({ home }),
      signIn: ({ password }) => signInOpSession({ account: account.value, password }),
      whoami: ({ env }) => runOpSurface({ account: account.value, env, surface: "account-whoami" }),
    },
  });
  if ("reason" in resolved) {
    return resolved;
  }
  const { env } = resolved;
  return {
    account: account.value,
    runner: ({ surface, id = null }) => runOpSurface({ account: account.value, env, id, surface }),
  };
}

/**
 * Where the live per-kind lane writes, or nowhere at all under `--json`.
 *
 * `--json` must stay ONE parseable document, so the lane is silenced rather than redirected — the same
 * per-kind facts are in the report that JSON carries.
 *
 * @param json whether the caller asked for JSON
 * @returns the sink to hand the sync
 */
function progressSinkFor({ json }: { json: boolean }): OnepasswordProgress {
  if (json) {
    return (): void => {};
  }
  return ({ line }): void => {
    logger.out({ line });
  };
}

/**
 * Print what the sync established: the whole document under `--json`, otherwise only the tail.
 *
 * The kinds already streamed through the progress sink as they landed, so reprinting them here is the wall
 * a 5,248-finding run taught this verb not to write.
 *
 * @param json whether the caller asked for JSON
 * @param report what the sync established
 */
function printOnepasswordOutcome({ json, report }: { json: boolean; report: OnepasswordSyncReport }): void {
  if (json) {
    logger.out({ line: JSON.stringify(report, null, 2) });
    return;
  }
  for (const line of renderOnepasswordTailLines({ report })) {
    logger.out({ line });
  }
}

/**
 * Run the `onepassword sync` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runOnepasswordSync(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: ONEPASSWORD_SYNC_USAGE });
    return EXIT_OK;
  }
  const parsed = parseOnepasswordSyncOptions({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: ONEPASSWORD_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { home, json, since } = parsed.value;
  const at = new Date().toISOString();

  progressSinkFor({ json })({ line: "checking for an `op` session…" });
  const probe = probeOpSession({ home });
  if ("reason" in probe) {
    logger.error({ msg: `the roster half is unavailable: ${probe.reason}` });
  }
  const token = onepasswordEventsToken({ home });
  const eventsCredentials = resolveOnepasswordEventsCredentials({
    env: { ...process.env, ...(token === undefined ? {} : { ONEPASSWORD_EVENTS_TOKEN: token }) },
  });
  const announce = progressSinkFor({ json });
  for (const line of renderOnepasswordChannelLines({
    adminCliConfigured: !("reason" in probe),
    eventsConfigured: eventsCredentials.isOk(),
  })) {
    announce({ line });
  }
  const result = await syncOnepasswordAtlas({
    at,
    buildEventsClient: ({ credentials }) => createOnepasswordEventsClient({ credentials }),
    eventsCredentials,
    home,
    logger,
    onProgress: progressSinkFor({ json }),
    runOp: "reason" in probe ? null : probe.runner,
    since: onepasswordSinceFor({ at, since }),
  });
  if (result.isErr()) {
    result.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_ERROR;
  }

  printOnepasswordOutcome({ json, report: result.value });
  return closeOnepasswordSync({ report: result.value });
}

/**
 * The exit code a finished sync earns, ending a failed one on the stderr line that names why — last, because
 * the slot record of a scheduled run keeps only stderr's closing lines.
 *
 * @param report what the sync established
 * @returns the process exit code
 */
function closeOnepasswordSync({ report }: { report: OnepasswordSyncReport }): number {
  const exitCode = exitCodeForOnepasswordSyncReport({
    exitError: EXIT_ERROR,
    exitExpectedEmpty: EXIT_EXPECTED_EMPTY,
    exitOk: EXIT_OK,
    report,
  });
  const closing = onepasswordSyncFailureClosingLine({ report });
  if (exitCode === EXIT_ERROR && closing !== null) {
    logger.error({ msg: closing });
  }
  return exitCode;
}

export const onepasswordSyncCommand = defineCommand({ run: runOnepasswordSync });

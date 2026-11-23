/**
 * `slopweaver codex hooks` — which of Slopweaver's plugin hooks Codex will skip in one `$CODEX_HOME`, and, with
 * `--trust`, Codex trusting every one the fleet installed.
 *
 * The bare form only reads: it asks that store's own app-server `hooks/list` (`src/codex/hookTrust.ts` carries
 * why Codex, not a re-derived hash, is the source). `--trust` then has the same app-server write
 * `trusted_hash = currentHash` for each untrusted or modified hook of the plugin `codex plugin-sync` installs,
 * and reports the re-list — the fleet's act, never a step for their hands. `codex
 * plugin-sync` runs the same trust after every refresh, so a landing that changes a hook needs nobody. The
 * launch loads the installed plugins, which the account reads deliberately never do, so this spends no token
 * but may let Codex refresh its own curated marketplace.
 *
 * Exit 3 when a hook is still skipped or the store cannot be read: a status, not a fault, so `codex hooks ||
 * alert` fires on exactly the case worth a look. Exit 1 when `--trust` was asked and Codex refused the write.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import { runningCheckoutRoot } from "#lib/gitRepo.js";
import { logger } from "#lib/logger.js";
import { exchangeWithCodexStores } from "../../../codex/accountLive.js";
import {
  type CodexHookTrustReading,
  HOOKS_LIST_REQUEST_ID,
  hookListRequests,
  hooksToTrust,
  parseHookTrust,
  renderHookTrust,
  TRUST_WRITE_REQUEST_ID,
  trustWriteFailure,
  trustWriteRequests,
} from "../../../codex/hookTrust.js";
import { CODEX_PLUGIN_NAME } from "../../../codexPlugin/plan.js";
import { personalMarketplaceEntry } from "../../../codexPlugin/sync.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";

/** Where a `codex <verb>` flag tail begins in `process.argv`: `[node, cli, codex, hooks, ...]`. */
const VERB_ARG_OFFSET = 4;

/** How long the one `hooks/list` exchange may take — a plugin-loading launch is slower than an account read. */
const HOOKS_LIST_DEADLINE_MS = 20_000;

/** The flags `codex hooks` accepts, without their leading `--`. */
const HOOKS_FLAGS: FlagSpec = { boolean: ["json", "trust"], string: ["codex-home"] };

/** The same flags, `--`-prefixed, for the help-truth ratchet. */
export const CODEX_HOOKS_FLAG_NAMES: readonly string[] = [
  ...booleanFlagsOf({ spec: HOOKS_FLAGS }),
  ...stringFlagsOf({ spec: HOOKS_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** Usage for `codex hooks`, shared by `--help` and the manifest. */
export const CODEX_HOOKS_USAGE = "usage: slopweaver codex hooks [--codex-home <dir>] [--trust] [--json]";

/**
 * Parse `codex hooks` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the verb's argument tail
 * @returns the parsed flags, or the errors
 */
export function parseCodexHooksArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: HOOKS_FLAGS });
}

/** `--codex-home` when named, else `$CODEX_HOME`, else Codex's own default under the user's home. */
function codexHomeOf({ named }: { named: unknown }): string {
  if (typeof named === "string" && named.length > 0) {
    return named;
  }
  const fromEnv = process.env["CODEX_HOME"];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  return join(homedir(), ".codex");
}

/**
 * Ask one store's app-server which Slopweaver hooks it lists, and read the answer.
 *
 * @param codexHome the store to ask
 * @param cwd the checkout the question is asked from
 * @returns every Slopweaver plugin hook with its trust, or why the store could not be read
 */
export function readCodexHookTrust({ codexHome, cwd }: { codexHome: string; cwd: string }): CodexHookTrustReading {
  const exchanged = exchangeWithCodexStores({
    answerIds: [HOOKS_LIST_REQUEST_ID],
    codexHomes: [codexHome],
    deadlineMs: HOOKS_LIST_DEADLINE_MS,
    requests: hookListRequests({ cwd }),
    scope: "plugin-hooks",
  });
  if ("reason" in exchanged) {
    return { kind: "unreadable", reason: exchanged.reason };
  }
  return parseHookTrust({ lines: exchanged.linesByStore[0]! });
}

/** What one trust pass did: how many hooks it asked Codex to trust, why the write failed, and the re-list. */
export interface CodexHookTrustPass {
  readonly trusted: number;
  readonly failure: string | undefined;
  readonly reading: CodexHookTrustReading;
}

/**
 * Have one store's Codex trust every Slopweaver hook of `pluginId` it skips for want of trust, then re-list.
 *
 * @param codexHome the store to write
 * @param cwd the checkout the question is asked from
 * @param pluginId the exact plugin id `codex plugin-sync` installs — no other plugin's hook is ever trusted
 * @returns the pass, its reading being the re-list when a write was sent and the first read when none was due
 */
export function trustCodexHooks({
  codexHome,
  cwd,
  pluginId,
}: {
  codexHome: string;
  cwd: string;
  pluginId: string;
}): CodexHookTrustPass {
  const before = readCodexHookTrust({ codexHome, cwd });
  if (before.kind === "unreadable") {
    return { failure: undefined, reading: before, trusted: 0 };
  }
  const due = hooksToTrust({ hooks: before.hooks, pluginId });
  if (due.length === 0) {
    return { failure: undefined, reading: before, trusted: 0 };
  }
  const exchanged = exchangeWithCodexStores({
    answerIds: [TRUST_WRITE_REQUEST_ID, HOOKS_LIST_REQUEST_ID],
    codexHomes: [codexHome],
    deadlineMs: HOOKS_LIST_DEADLINE_MS,
    requests: trustWriteRequests({ cwd, hooks: due }),
    scope: "plugin-hooks",
  });
  if ("reason" in exchanged) {
    return { failure: exchanged.reason, reading: before, trusted: 0 };
  }
  const lines = exchanged.linesByStore[0]!;
  const failure = trustWriteFailure({ lines });
  return { failure, reading: parseHookTrust({ lines }), trusted: failure === undefined ? due.length : 0 };
}

/**
 * The one line a trust pass prints above the report.
 *
 * @param codexHome the store written
 * @param pass what the pass did
 * @returns the line
 */
export function renderTrustPass({ codexHome, pass }: { codexHome: string; pass: CodexHookTrustPass }): string {
  if (pass.failure !== undefined) {
    return `codex hooks: Codex did not write trust in ${codexHome} — ${pass.failure}`;
  }
  // An unreadable first read sent no write, which is not "nothing was waiting": the report below names why.
  if (pass.trusted === 0 && pass.reading.kind === "unreadable") {
    return `codex hooks: nothing was trusted in ${codexHome} — its hooks could not be read`;
  }
  if (pass.trusted === 0) {
    return `codex hooks: no Slopweaver hook in ${codexHome} was waiting on trust`;
  }
  return `codex hooks: Codex trusted ${String(pass.trusted)} Slopweaver hook(s) in ${codexHome}`;
}

/**
 * The plugin id `codex plugin-sync` installs, or why there is none to trust.
 *
 * @param userHome the user's home, root of the personal Codex marketplace
 * @returns `slopweaver@<marketplace>`, or the reason
 */
export function installedPluginId({ userHome }: { userHome: string }): { pluginId: string } | { reason: string } {
  const entry = personalMarketplaceEntry({ userHome });
  if (entry.isErr()) {
    return { reason: entry.error.message };
  }
  if ("skip" in entry.value) {
    return { reason: entry.value.skip };
  }
  return { pluginId: `${CODEX_PLUGIN_NAME}@${entry.value.marketplace}` };
}

/** `--trust`: resolve the plugin and write, handing back the pass line and the re-list. */
function runTrust({ codexHome }: { codexHome: string }): {
  reading: CodexHookTrustReading;
  exit: number;
  line: string;
} {
  const plugin = installedPluginId({ userHome: homedir() });
  if ("reason" in plugin) {
    return {
      exit: EXIT_EXPECTED_EMPTY,
      line: `codex hooks: nothing to trust — ${plugin.reason}`,
      reading: { kind: "unreadable", reason: plugin.reason },
    };
  }
  const pass = trustCodexHooks({ codexHome, cwd: runningCheckoutRoot(), pluginId: plugin.pluginId });
  return {
    exit: pass.failure === undefined ? EXIT_OK : EXIT_ERROR,
    line: renderTrustPass({ codexHome, pass }),
    reading: pass.reading,
  };
}

/**
 * Run the verb.
 *
 * @param argv the whole process argv
 * @returns 0 when Codex runs every Slopweaver hook, 3 when it skips one or the store could not be read, 1 when
 *   `--trust` was asked and Codex did not write it
 */
export function runCodexHooks(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CODEX_HOOKS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCodexHooksArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      logger.error({ msg: problem });
    }
    logger.error({ msg: CODEX_HOOKS_USAGE });
    return EXIT_USAGE;
  }
  const codexHome = codexHomeOf({ named: parsed.value.values["codex-home"] });
  const trust = parsed.value.values["trust"] === true;
  const trusted = trust
    ? runTrust({ codexHome })
    : { exit: EXIT_OK, reading: readCodexHookTrust({ codexHome, cwd: runningCheckoutRoot() }) };
  if (trusted.exit === EXIT_EXPECTED_EMPTY && "line" in trusted) {
    logger.error({ msg: trusted.line });
    return EXIT_EXPECTED_EMPTY;
  }
  const report = renderHookTrust({ codexHome, reading: trusted.reading });
  printHookReport({
    codexHome,
    json: parsed.value.values["json"] === true,
    reading: trusted.reading,
    report,
    trustLine: "line" in trusted ? trusted.line : undefined,
  });
  if (trusted.exit !== EXIT_OK) {
    return trusted.exit;
  }
  return report.allRun ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

/** Print the report, with the trust pass's line above it when `--trust` ran, as one JSON document on `--json`. */
function printHookReport({
  codexHome,
  json,
  reading,
  report,
  trustLine,
}: {
  codexHome: string;
  json: boolean;
  reading: CodexHookTrustReading;
  report: { allRun: boolean; lines: readonly string[] };
  trustLine: string | undefined;
}): void {
  if (json) {
    logger.out({
      line: JSON.stringify({
        allRun: report.allRun,
        codexHome,
        reading,
        ...(trustLine === undefined ? {} : { trustLine }),
      }),
    });
    return;
  }
  for (const line of trustLine === undefined ? report.lines : [trustLine, ...report.lines]) {
    logger.out({ line });
  }
}

export const codexHooksCommand = defineCommand({ run: runCodexHooks });

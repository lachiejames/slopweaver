/**
 * The effectful shell behind `cloudflare sync`: resolves the token, the account/deep-zone selection (both
 * the pure format check and the live verification against the real account), builds the guarded SDK
 * client, wires progress, and runs `syncCloudflareAtlas`.
 */
import type Cloudflare from "cloudflare";

import { createCloudflareClient, resolveLiveCloudflareScope } from "../../../atlas/cloudflare/client.js";
import { resolveCloudflareSelection } from "../../../atlas/cloudflare/config.js";
import type { CloudflareSelection } from "../../../atlas/cloudflare/model.js";
import { type CloudflareSyncReport, syncCloudflareAtlas } from "../../../atlas/cloudflare/sync.js";
import { cloudflareToken } from "../../../config.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { createRichProgressEmitter } from "../../../lib/progressRichEmitter.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { parseCloudflareSyncOptions } from "./core.js";

/**
 * Exported so a test can assert this equals the manifest's own copy — the manifest cannot import it
 * directly without eagerly loading this module's atlas-sync dependency for every CLI invocation, not just
 * this verb's.
 */
export const CLOUDFLARE_SYNC_USAGE =
  "usage: slopweaver cloudflare sync [--account-id <id>] [--deep-zone <name>] [--json] [--home <dir>]";

/**
 * Resolve the token and the live-verified account/deep-zone selection this run needs, or every reason it
 * cannot proceed. Kept together because both come from the same environment, and a caller needing one
 * always needs the other.
 *
 * @param home the resolved `$SLOPWEAVER_HOME` — where the token falls back to if no env var names one
 * @param env the environment to read
 * @returns the resolved client and live-verified selection, or every reason resolution failed
 */
export async function resolveSyncPrerequisites({
  accountIdFlag,
  deepZoneFlag,
  home,
  env,
}: {
  accountIdFlag: string | undefined;
  deepZoneFlag: string | undefined;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
}): Promise<Result<{ client: Cloudflare; selection: CloudflareSelection }>> {
  const token = cloudflareToken({ home });
  if (token === undefined) {
    return err(["no Cloudflare token configured — run: slopweaver secrets set cloudflare-token"]);
  }
  const selectionInput = resolveCloudflareSelection({
    env,
    ...(accountIdFlag !== undefined ? { accountIdFlag } : {}),
    ...(deepZoneFlag !== undefined ? { deepZoneFlag } : {}),
  });
  if (selectionInput.isErr()) {
    return err(selectionInput.error);
  }
  const client = createCloudflareClient({ apiToken: token });
  const live = await resolveLiveCloudflareScope({ client, selection: selectionInput.value });
  return live.isErr() ? err([live.error.message]) : ok({ client, selection: live.value });
}

/**
 * Sync the Cloudflare atlas end to end: resolve prerequisites, wire progress, and run.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @param env the environment to read
 * @param now this run's ISO timestamp
 * @returns the sync report, or every reason the run could not proceed
 */
export async function runCloudflareSyncOnce({
  accountIdFlag,
  deepZoneFlag,
  home,
  env,
  now,
}: {
  accountIdFlag: string | undefined;
  deepZoneFlag: string | undefined;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  now: string;
}): Promise<Result<CloudflareSyncReport>> {
  const prerequisites = await resolveSyncPrerequisites({ accountIdFlag, deepZoneFlag, env, home });
  if (prerequisites.isErr()) {
    return err(prerequisites.error);
  }
  const progress = createRichProgressEmitter({ verb: "cloudflare sync" });
  return syncCloudflareAtlas({
    at: now,
    client: prerequisites.value.client,
    home,
    progress,
    selection: prerequisites.value.selection,
  });
}

/**
 * Print one sync report, plain or `--json`.
 *
 * @param report the completed report
 * @param json whether to print machine-readable JSON
 */
function printSyncReport({ report, json }: { report: CloudflareSyncReport; json: boolean }): void {
  if (json) {
    logger.out({ line: JSON.stringify(report, null, 2) });
    return;
  }
  for (const kind of report.kinds) {
    const status = kind.complete ? "synced" : `incomplete (${kind.reasons.join("; ")})`;
    logger.out({
      line: `${kind.kind}: ${status} — ${String(kind.entityCount)} entit${kind.entityCount === 1 ? "y" : "ies"}`,
    });
  }
  if (report.lockReleaseError !== null) {
    logger.error({ msg: `lock release failed: ${report.lockReleaseError}` });
  }
}

/**
 * Run the `cloudflare sync` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runCloudflareSyncArgv(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CLOUDFLARE_SYNC_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCloudflareSyncOptions({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: CLOUDFLARE_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { accountIdFlag, deepZoneFlag, home, json } = parsed.value;
  const result = await runCloudflareSyncOnce({
    accountIdFlag,
    deepZoneFlag,
    env: process.env,
    home,
    now: new Date().toISOString(),
  });
  if (result.isErr()) {
    result.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_ERROR;
  }
  printSyncReport({ json, report: result.value });
  return EXIT_OK;
}

export const cloudflareSyncCommand = defineCommand({ run: runCloudflareSyncArgv });

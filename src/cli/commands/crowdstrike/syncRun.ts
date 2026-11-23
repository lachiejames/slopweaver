/**
 * `slopweaver crowdstrike sync [--json] [--home <dir>]` — build the local CrowdStrike Falcon atlas's API
 * surface: hosts, host groups, prevention and sensor-update policies, Spotlight findings, Zero Trust
 * scores and detections.
 *
 * A thin shell over `atlas/crowdstrike/sync.ts`; the domain owns the closed inventory, the projection
 * allowlist, the merge and the publish. What is genuinely here is the credential resolution and the exit
 * code, both of which need the process.
 *
 * ## The exit-code contract
 *
 * | situation                                                          | code |
 * | ------------------------------------------------------------------ | ---- |
 * | a bad flag                                                         | `2`  |
 * | no credential configured at all                                    | `3`  |
 * | no kind synced — every family refused                              | `3`  |
 * | a hard refusal: an untrusted generation, a refused publish         | `1`  |
 * | some kinds synced and some did not                                 | `1`  |
 * | every kind synced                                                  | `0`  |
 *
 * A kind refused for want of a scope reaches the `1` row rather than the `0` one, and that is the point: it
 * publishes an `unreadable` coverage cell naming the scope, so the run reports honestly instead of exiting
 * clean over a hole.
 */
import type { CrowdstrikeClientDeps, CrowdstrikeFetch } from "../../../atlas/crowdstrike/client.js";
import { resolveCrowdstrikeCredentials } from "../../../atlas/crowdstrike/credentialFiles.js";
import { crowdstrikeAtlasPaths } from "../../../atlas/crowdstrike/store.js";
import { syncCrowdstrikeApiSurface } from "../../../atlas/crowdstrike/sync.js";
import { createTokenProvider, fetchCrowdstrikeToken } from "../../../atlas/crowdstrike/tokenProvider.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import {
  CROWDSTRIKE_SYNC_USAGE,
  exitCodeForCrowdstrikeSync,
  parseCrowdstrikeSyncOptions,
  renderCrowdstrikeSyncLines,
} from "./core.js";

/**
 * The production HTTP seam: one `fetch`, and nothing a caller can steer.
 *
 * It takes a URL the client built from the closed inventory, never one assembled here, which is what keeps
 * "no endpoint outside the inventory is reachable" a property of the code rather than a convention.
 *
 * @returns the fetch implementation the client drives
 */
export function productionCrowdstrikeFetch(): CrowdstrikeFetch {
  return async ({ url, method, headers, body }) => {
    // `body` is spread in rather than passed always-present: `fetch` rejects a body on a GET, and the
    // inventory's reads are a mix of both.
    const response = await fetch(url, { headers: { ...headers }, method, ...(body === null ? {} : { body }) });
    return { status: response.status, text: await response.text() };
  };
}

/**
 * Resolve the credential triple into everything the client needs.
 *
 * The triple is read from the secrets store or the environment and never from an argument, so a run has no
 * way to be pointed at a different tenant by its command line.
 *
 * @param home the state home whose `secrets/` directory holds the credential
 * @returns the client dependencies, or every reason the credential could not be resolved
 */
function resolveClientDeps({ home }: { home: string }): Result<CrowdstrikeClientDeps> {
  const credentials = resolveCrowdstrikeCredentials({ env: process.env, home });
  if (credentials.isErr()) {
    return err(credentials.error);
  }
  return ok({
    apiHost: credentials.value.apiHost,
    fetch: productionCrowdstrikeFetch(),
    nowMs: () => Date.now(),
    tokens: createTokenProvider({ credentials: credentials.value, mint: fetchCrowdstrikeToken }),
  });
}

/**
 * Run the `crowdstrike sync` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runCrowdstrikeSync(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CROWDSTRIKE_SYNC_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCrowdstrikeSyncOptions({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: CROWDSTRIKE_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { home, json } = parsed.value;
  const deps = resolveClientDeps({ home });
  if (deps.isErr()) {
    deps.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_EXPECTED_EMPTY;
  }

  const result = await syncCrowdstrikeApiSurface({
    at: new Date().toISOString(),
    deps: deps.value,
    paths: crowdstrikeAtlasPaths({ home }),
    ...(json
      ? {}
      : {
          progress: ({ line }: { line: string }) => {
            logger.out({ line });
          },
        }),
  });
  if (result.isErr()) {
    result.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_ERROR;
  }

  if (json) {
    logger.out({ line: JSON.stringify(result.value, null, 2) });
  } else {
    for (const line of renderCrowdstrikeSyncLines({ outcome: result.value })) {
      logger.out({ line });
    }
  }
  return exitCodeForCrowdstrikeSync({
    exitError: EXIT_ERROR,
    exitExpectedEmpty: EXIT_EXPECTED_EMPTY,
    exitOk: EXIT_OK,
    outcome: result.value,
  });
}

export const crowdstrikeSyncCommand = defineCommand({ run: runCrowdstrikeSync });

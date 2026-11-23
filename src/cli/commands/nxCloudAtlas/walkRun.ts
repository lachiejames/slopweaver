/**
 * `slopweaver atlas nx-cloud walk [--org <id>] [--workspace <id>] [--json] [--home <dir>]` — fill the
 * BROWSER surface by walking every declared route in the owner's own Chrome and photographing each.
 *
 * Nothing here launches a browser: the transport attaches to the owner's already-running Chrome through the
 * Playwright Extension relay `playwright-core` ships (`docs/browser-route/target-proof-and-playwright.md`),
 * and `docs/browser-route.md` carries the ruling. The
 * walk NAVIGATES and observes — no click, no form, no request replay — so the pages' own calls are passive
 * observations rather than actions taken on the owner's behalf.
 */
import { verifiedArtifactWriter } from "../../../atlas/kit/artifactWriter.js";
import { attachWalkTransport } from "../../../atlas/kit/walkTransport.js";
import { type NxCloudBrowserObservation, publishNxCloudBrowserSurface } from "../../../atlas/nxCloud/browserSurface.js";
import { walkNxCloudBrowser } from "../../../atlas/nxCloud/browserWalk.js";
import { NX_CLOUD_ORIGIN } from "../../../atlas/nxCloud/inventory.js";
import { type NxCloudAtlasPaths, nxCloudAtlasPaths } from "../../../atlas/nxCloud/store.js";
import type { NxCloudScope } from "../../../atlas/nxCloud/webData.js";
import type { BrowserPageTransport } from "../../../browser/pageTransport.js";
import { recordedProfilePort } from "../../../browser/recordedProfile.js";
import { loadDenylist } from "../../../hygiene/scan.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

import { resolveNxCloudScopes } from "./scope.js";

/** Where an Nx Cloud atlas verb sits: past the runtime, the script, the `atlas` noun and the platform. */
const NX_CLOUD_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const NX_CLOUD_WALK_USAGE =
  "usage: slopweaver atlas nx-cloud walk [--org <id>] [--workspace <id>] [--json] [--home <dir>]";

/** What this verb accepts. */
interface WalkOptions {
  readonly home: string;
  readonly json: boolean;
  readonly orgId: string | undefined;
  readonly workspaceId: string | undefined;
}

/**
 * Parse the flag tail this verb accepts.
 *
 * @param rest the argv tail past the verb
 * @returns the options, or why the invocation is unusable
 */
function parseWalkOptions({ rest }: { rest: readonly string[] }): Result<WalkOptions> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "org", "workspace"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({
    home: resolveHome({ named: parsed.value.values["home"] }),
    json: parsed.value.flags.has("json"),
    orgId: parsed.value.values["org"],
    workspaceId: parsed.value.values["workspace"],
  });
}

/**
 * Print what the walk published.
 *
 * @param asJson whether to print the machine shape
 * @param counts the walk's own numbers
 * @param workspaceId which workspace was walked
 */
function report({
  asJson,
  counts,
  workspaceId,
}: {
  asJson: boolean;
  counts: NxCloudBrowserObservation["counts"];
  workspaceId: string;
}): void {
  if (asJson) {
    logger.out({ line: JSON.stringify({ counts, workspaceId }, null, 1) });
    return;
  }
  logger.out({
    line:
      `nx-cloud browser walk — workspace ${workspaceId}: ${String(counts.reached)} of ` +
      `${String(counts.walked)} declared route(s) reached, ${String(counts.held)} photographed; the client ` +
      `itself declared ${String(counts.clientDeclared)} route(s) during the walk`,
  });
}

/**
 * Run the Nx Cloud browser walk.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function nxCloudAtlasWalkCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: NX_CLOUD_VERB_INDEX, verbs: ["walk"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: NX_CLOUD_WALK_USAGE });
    return EXIT_OK;
  }
  const options = parseWalkOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: NX_CLOUD_WALK_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson, orgId, workspaceId } = options.value;
  const paths = nxCloudAtlasPaths({ home });
  const scopes = resolveNxCloudScopes({ orgId, paths, workspaceId });
  if (scopes.isErr()) {
    scopes.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_USAGE;
  }
  const attached = await attachWalkTransport({
    directory: paths.directory,
    home,
    origins: [NX_CLOUD_ORIGIN],
    platform: "nx-cloud",
    profiles: recordedProfilePort(),
  });
  if (attached.isErr()) {
    attached.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  const transport = attached.value;
  try {
    for (const scope of scopes.value) {
      const walked = await walkOneScope({ asJson, denylist: loadDenylist({ home }), paths, scope, transport });
      if (walked !== EXIT_OK) {
        return walked;
      }
    }
  } finally {
    await transport.release();
  }
  return EXIT_OK;
}

/**
 * Walk one scope's pages and publish what the walk saw.
 *
 * @param transport the attached transport, released by the caller rather than here
 * @param paths the resolved atlas paths
 * @param scope the organisation and workspace to walk
 * @param denylist the private organisation words
 * @param asJson whether to print the machine shape
 * @returns the process exit code for this scope
 */
async function walkOneScope({
  transport,
  paths,
  scope,
  denylist,
  asJson,
}: {
  transport: BrowserPageTransport;
  paths: NxCloudAtlasPaths;
  scope: NxCloudScope;
  denylist: readonly string[];
  asJson: boolean;
}): Promise<number> {
  const walked = await walkNxCloudBrowser({
    progress: ({ line }) => {
      logger.error({ msg: line });
    },
    scope,
    transport,
    writeArtifact: verifiedArtifactWriter({ directory: paths.directory }),
  });
  if (walked.isErr()) {
    walked.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  const published = publishNxCloudBrowserSurface({
    at: new Date().toISOString(),
    denylist,
    paths,
    scope,
    walk: walked.value,
  });
  if (published.isErr()) {
    published.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  report({ asJson, counts: published.value.counts, workspaceId: scope.workspaceId });
  return EXIT_OK;
}

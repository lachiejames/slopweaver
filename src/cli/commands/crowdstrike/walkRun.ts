/**
 * `slopweaver crowdstrike walk [--limit <n>] [--json] [--home <dir>]` — fill the atlas's BROWSER surface by
 * walking every page the Falcon console's own sitemap declares, in the owner's own Chrome.
 *
 * The walk, the reduction and the publish are the domain's (`atlas/crowdstrike/consoleWalk.ts`,
 * `consoleReduction.ts`, `consoleSurface.ts`) and every one of them is written against the transport SEAM,
 * so all of them are settled by unit tests over a fake. What is here is the effects: attaching to the owner's
 * browser, reading the console's own sitemap through it, and writing the screenshots to disk.
 *
 * ## The denominator is fetched, not written down
 *
 * The first thing the walk visits is `/content/sitemap-v2/index.json`, and the route list comes out of that
 * document. There is no hand-written page list anywhere in this verb, which is the whole reason the
 * coverage claim is checkable: a page the console declares and this walk never reached is a gap the atlas
 * can name.
 *
 * ## `--limit` is for proving the lane, never for a real generation
 *
 * It stops after n routes and the published coverage says so, because a partial walk that reported itself
 * as complete is exactly the failure the sibling Slack walk shipped once.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { writeAtomicBytes } from "../../../atlas/atlasFile.js";
import { type ConsoleSurfaceOutcome, publishConsoleWalk } from "../../../atlas/crowdstrike/consoleSurface.js";
import { PAGE_SETTLE_MS, walkFalconConsole } from "../../../atlas/crowdstrike/consoleWalk.js";
import { resolveCrowdstrikeCredentials } from "../../../atlas/crowdstrike/credentialFiles.js";
import { crowdstrikeConsoleOrigin } from "../../../atlas/crowdstrike/model.js";
import { type FalconRouteDeclaration, parseFalconSitemap } from "../../../atlas/crowdstrike/sitemap.js";
import { type CrowdstrikeAtlasPaths, crowdstrikeAtlasPaths } from "../../../atlas/crowdstrike/store.js";
import { browserErrorLines } from "../../../browser/browserErrors.js";
import { readExtensionToken } from "../../../browser/extensionToken.js";
import type { BrowserPageTransport } from "../../../browser/pageTransport.js";
import { createPlaywrightCliTransport, type PlaywrightCliDeps } from "../../../browser/playwrightCli.js";
import { resolveChromePin } from "../../../browser/profilePin.js";
import { type RecordedProfilePort, recordedProfilePort } from "../../../browser/recordedProfile.js";
import { realRelayLeaseWait } from "../../../browser/relayLease.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { CROWDSTRIKE_WALK_USAGE, parseCrowdstrikeWalkOptions } from "./core.js";
import { type CrowdstrikeVerbError, CrowdstrikeVerbErrors, crowdstrikeVerbErrorLines } from "./errors.js";

/** The console's own published navigation document — the walk's denominator. */
const SITEMAP_PATH = "/content/sitemap-v2/index.json";

/**
 * Read the console's sitemap through the browser session that is already attached.
 *
 * Fetched rather than shipped: it is session-authed, it changes as CrowdStrike ships features, and a list
 * committed here would be a denominator this repository chose for itself.
 *
 * @param transport the attached browser seam
 * @param origin the console origin
 * @returns the declared routes, or why the denominator could not be read
 */
async function readSitemap({
  transport,
  origin,
}: {
  transport: BrowserPageTransport;
  origin: string;
}): Promise<Result<readonly FalconRouteDeclaration[], CrowdstrikeVerbError>> {
  const visited = await transport.visit({ settleMs: PAGE_SETTLE_MS, url: `${origin}${SITEMAP_PATH}` });
  if (visited.isErr()) {
    return err(CrowdstrikeVerbErrors.sitemapUnread({ cause: visited.error.message }));
  }
  const document = visited.value.responses.find((response) => response.url.includes(SITEMAP_PATH));
  if (document === undefined) {
    return err(CrowdstrikeVerbErrors.sitemapAbsent({ path: SITEMAP_PATH }));
  }
  const parsed = parseFalconSitemap({ json: document.body, origin });
  return parsed.isErr()
    ? err(CrowdstrikeVerbErrors.sitemapInvalid({ reasons: parsed.error }))
    : ok(parsed.value.routes);
}

/**
 * Run the `crowdstrike walk` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runCrowdstrikeWalk(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["walk"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CROWDSTRIKE_WALK_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCrowdstrikeWalkOptions({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    return refuse({ problems: crowdstrikeVerbErrorLines({ error: parsed.error }), usage: true });
  }
  const { home, json, limit } = parsed.value;

  const profiles = recordedProfilePort();
  const ready = await prepareWalk({ home, profiles });
  if (ready.isErr()) {
    return refuse({ problems: crowdstrikeVerbErrorLines({ error: ready.error }), usage: false });
  }
  const { origin, paths, transport } = ready.value;

  const routes = await readSitemap({ origin, transport });
  if (routes.isErr()) {
    await transport.release();
    return refuse({ code: EXIT_ERROR, problems: crowdstrikeVerbErrorLines({ error: routes.error }), usage: false });
  }
  const selected = limit === undefined ? routes.value : routes.value.slice(0, limit);
  const progress = json
    ? {}
    : {
        progress: ({ line }: { line: string }) => {
          logger.out({ line });
        },
      };
  if (!json) {
    logger.out({
      line: `crowdstrike console: ${String(routes.value.length)} declared page(s); walking ${String(selected.length)}`,
    });
  }

  const walked = await walkFalconConsole({
    origin,
    routes: selected,
    transport,
    writeArtifact: ({ relativePath, bytes }) => writeAtomicBytes({ bytes, path: join(paths.directory, relativePath) }),
    ...progress,
  });
  if (walked.isErr()) {
    return refuse({ code: EXIT_ERROR, problems: walked.error, usage: false });
  }
  const published = publishConsoleWalk({ at: new Date().toISOString(), origin, paths, walk: walked.value });
  if (published.isErr()) {
    return refuse({ code: EXIT_ERROR, problems: published.error, usage: false });
  }
  report({ artifactsWritten: walked.value.artifactsWritten, json, outcome: published.value });
  return published.value.landedCount === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/** Print every reason and return the exit code that names it. */
function refuse({
  problems,
  usage,
  code = EXIT_EXPECTED_EMPTY,
}: {
  problems: readonly string[];
  usage: boolean;
  code?: number;
}): number {
  problems.forEach((problem) => {
    logger.error({ msg: problem });
  });
  if (usage) {
    logger.error({ msg: CROWDSTRIKE_WALK_USAGE });
    return EXIT_USAGE;
  }
  return code;
}

/**
 * Everything a walk needs before it can visit a page: the console origin, the atlas paths, and a transport
 * already attached to the owner's own Chrome.
 *
 * Grouped into one function so the verb reads as a sequence of steps rather than as a wall of guards, and
 * so every one of the four ways this can refuse — no credential, an unrecognised host, no consent token,
 * a browser that could not be reached — is reported in the same shape.
 *
 * @param home the state home holding the credential, the token and the atlas
 * @param profiles the door the recorded work profile is read through
 * @returns the origin, paths and attached transport, or every reason the walk cannot start
 */
async function prepareWalk({
  home,
  profiles,
}: {
  home: string;
  profiles: RecordedProfilePort;
}): Promise<
  Result<{ origin: string; paths: CrowdstrikeAtlasPaths; transport: BrowserPageTransport }, CrowdstrikeVerbError>
> {
  const credentials = resolveCrowdstrikeCredentials({ env: process.env, home });
  if (credentials.isErr()) {
    return err(CrowdstrikeVerbErrors.credentialsUnresolved({ reasons: credentials.error }));
  }
  const origin = crowdstrikeConsoleOrigin({ apiHost: credentials.value.apiHost });
  if (origin === null) {
    return err(CrowdstrikeVerbErrors.originUnpaired({ apiHost: credentials.value.apiHost }));
  }
  const token = readExtensionToken({ home });
  if (token.isErr()) {
    return err(CrowdstrikeVerbErrors.extensionTokenUnread({ reasons: browserErrorLines({ error: token.error }) }));
  }
  const pin = await resolveChromePin({ home, path: stateHomePaths({ home }).chromePin, profiles });
  if (pin.isErr()) {
    return err(CrowdstrikeVerbErrors.chromePinUnresolved({ cause: pin.error }));
  }
  const paths = crowdstrikeAtlasPaths({ home });
  const scratchDir = join(paths.directory, "artifacts", "_incoming");
  mkdirSync(scratchDir, { recursive: true });
  const deps: PlaywrightCliDeps = {
    chromePinPath: pin.value,
    extensionToken: token.value,
    home,
    leaseWait: realRelayLeaseWait(),
    nowIso: () => new Date().toISOString(),
    origins: [origin],
    platform: "crowdstrike",
    scratchDir,
  };
  // No eager attach here. Reaching the relay is what the machine-wide lease guards, and the lease is taken
  // on the first `visit` — so a pre-flight attach would open a connect tab, and could take the relay daemon
  // off a walk that legitimately holds the lease, before anything had checked whether this walk may run at
  // all. The first visit reports the same typed `TRANSPORT_UNAVAILABLE`, which this walk already stops on.
  return ok({ origin, paths, transport: createPlaywrightCliTransport({ deps }) });
}

/** Print what the walk established: the whole document under `--json`, otherwise one line. */
function report({
  json,
  outcome,
  artifactsWritten,
}: {
  json: boolean;
  outcome: ConsoleSurfaceOutcome;
  artifactsWritten: number;
}): void {
  if (json) {
    logger.out({ line: JSON.stringify(outcome, null, 2) });
    return;
  }
  logger.out({
    line: `crowdstrike console: ${String(outcome.landedCount)} of ${String(outcome.pageCount)} page(s) landed, ${String(outcome.requestCount)} distinct endpoint(s) recorded, ${String(artifactsWritten)} screenshot(s) kept`,
  });
}

export const crowdstrikeWalkCommand = defineCommand({ run: runCrowdstrikeWalk });

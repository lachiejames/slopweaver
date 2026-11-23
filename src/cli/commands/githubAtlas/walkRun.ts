/**
 * `slopweaver atlas github walk [--orgs <login,...>] [--repos <owner/repo,...>] [--rounds <n>]` — fill the
 * atlas's BROWSER surface by walking GitHub's admin pages in the owner's own Chrome.
 *
 * The walk, the reduction and the publish are the domain's (`atlas/github/webWalk.ts`, `webReduction.ts`,
 * `webSurface.ts`) and every one of them is written against the transport SEAM, so all of them are settled
 * by unit tests over a fake. What is here is the effects: attaching to the owner's browser, and writing the
 * screenshots to disk.
 *
 * ## There is no `--limit`, and its absence is the point
 *
 * The sibling CrowdStrike walk takes one, publishes the slice it reached and exits zero — which is exactly
 * how a partial walk comes to report itself as complete. `--rounds` is not that flag: it bounds frontier
 * EXPANSION, every discovered-but-unvisited page is returned in `frontierRemaining`, and a walk that did
 * not close its frontier publishes `deferred` coverage plus an `incomplete-read` gap naming the count. A
 * bounded run therefore cannot be mistaken for an exhaustive one by anything downstream.
 *
 * ## The relay is released, always
 *
 * `walkGithubAdmin` releases the transport on every exit path. The Playwright Extension serves one client
 * at a time and several sessions on this machine run atlas walks, so a verb that held the relay after
 * finishing would be denying it to the next one — measured on this machine, four relay daemons were alive
 * at once and the losers failed with a message about a lost session rather than a busy one.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { writeAtomicBytes } from "../../../atlas/atlasFile.js";
import type { GithubRestRoute } from "../../../atlas/github/restSurface.js";
import { type GithubAtlasPaths, githubAtlasPaths } from "../../../atlas/github/store.js";
import { githubSettingsSeeds } from "../../../atlas/github/webRoutes.js";
import { publishGithubWebWalk } from "../../../atlas/github/webSurface.js";
import { type GithubWebWalkResult, walkGithubAdmin } from "../../../atlas/github/webWalk.js";
import { browserErrorLines } from "../../../browser/browserErrors.js";
import { readExtensionToken } from "../../../browser/extensionToken.js";
import { createPlaywrightCliTransport } from "../../../browser/playwrightCli.js";
import { resolveChromePin } from "../../../browser/profilePin.js";
import { recordedProfilePort } from "../../../browser/recordedProfile.js";
import { realRelayLeaseWait } from "../../../browser/relayLease.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import {
  GITHUB_WALK_USAGE,
  type GithubWalkOptions,
  parseGithubWalkOptions,
  renderGithubWalk,
} from "../atlas/githubCore.js";
import { type GithubAtlasVerbError, GithubAtlasVerbErrors, githubAtlasVerbErrorLines } from "./errors.js";
import { compileGithubRestSurface } from "./restSurfaceRun.js";

/** Where the verb sits: past the runtime, the script, the `atlas` noun, the `github` platform and `walk`. */
const VERB_DEPTH = 5;

/** GitHub's own web origin. Enterprise Server is not covered by this verb — see the descriptor. */
const WEB_ORIGIN = "https://github.com";

/**
 * Write one screenshot inside the atlas's own directory.
 *
 * @param directory the atlas root every artifact path is relative to
 * @returns the writer the walk calls
 */
function artifactWriter({
  directory,
}: {
  directory: string;
}): (input: { relativePath: string; bytes: Uint8Array }) => Result<null> {
  return ({ relativePath, bytes }) => {
    const full = join(directory, relativePath);
    const created = createArtifactDirectory({ full, relativePath });
    if (created.isErr()) {
      // The walk's `ArtifactWriter` contract answers a string list, so the typed refusal becomes its lines here.
      return err(githubAtlasVerbErrorLines({ error: created.error }));
    }
    return writeAtomicBytes({ bytes, path: full });
  };
}

/** Create the directory one screenshot is written into, or say which artifact it could not be made for. */
function createArtifactDirectory({
  full,
  relativePath,
}: {
  full: string;
  relativePath: string;
}): Result<null, GithubAtlasVerbError> {
  try {
    mkdirSync(dirname(full), { recursive: true });
  } catch {
    return err(GithubAtlasVerbErrors.artifactDirectoryUncreatable({ relativePath }));
  }
  return ok(null);
}

/**
 * Every route GitHub's own description declares, reduced to the same path SHAPE the walk records.
 *
 * A compile that fails yields an empty set, so every observed call is then recorded as undeclared — visible
 * in the report rather than silently absent.
 *
 * @returns the declared shapes, as `METHOD /path/<id>` strings
 */
function declaredRouteShapes(): ReadonlySet<string> {
  const compiled = compileGithubRestSurface();
  if (compiled.isErr()) {
    return new Set<string>();
  }
  return githubDeclaredRouteShapes({ routes: compiled.value.routes });
}

/**
 * Reduce declared routes to the path SHAPE the walk records.
 *
 * Every template segment (`{org}`) becomes `<id>`, the same placeholder an observed id segment reduces to,
 * which is what lets a browser-observed call be compared against the published surface at all.
 *
 * @param routes the routes GitHub's own description declares
 * @returns the distinct shapes, as `METHOD /path/<id>` strings, in first-seen order
 *
 * @internal
 */
export function githubDeclaredRouteShapes({ routes }: { routes: readonly GithubRestRoute[] }): ReadonlySet<string> {
  return new Set(routes.map((route) => route.route.replace(/\{[^}]+\}/gu, "<id>")));
}

/**
 * Attach to the owner's Chrome and run the walk.
 *
 * The effects half, split from the verb shell so the shell stays a sequence of guarded steps. The transport
 * is constructed here rather than passed in because this is the only place that may construct one — the
 * walk itself takes the seam.
 *
 * @param options the parsed invocation
 * @param paths the resolved atlas paths, whose directory is both the scratch and the artifact root
 * @param token the Playwright extension consent token the owner provisioned
 * @param chromePinPath the shim Chrome is launched through, so the connect page opens in the work profile
 * @returns what the walk saw, or the reason it could not start
 */
async function runWalk({
  options,
  paths,
  token,
  chromePinPath,
}: {
  options: GithubWalkOptions;
  paths: GithubAtlasPaths;
  token: string;
  chromePinPath: string;
}): Promise<Result<GithubWebWalkResult>> {
  return walkGithubAdmin({
    origin: WEB_ORIGIN,
    seeds: githubSettingsSeeds({ organisations: options.organisations, repositories: options.repositories }),
    transport: createPlaywrightCliTransport({
      deps: {
        chromePinPath,
        extensionToken: token,
        home: options.home,
        leaseWait: realRelayLeaseWait(),
        nowIso: () => new Date().toISOString(),
        origins: [WEB_ORIGIN],
        platform: "github",
        scratchDir: paths.directory,
      },
    }),
    writeArtifact: artifactWriter({ directory: paths.directory }),
    ...(options.rounds === null ? {} : { maxRounds: options.rounds }),
    ...(options.json
      ? {}
      : {
          progress: ({ line }: { line: string }): void => {
            process.stderr.write(`${line}\n`);
          },
        }),
  });
}

/**
 * Walk, publish and render — the verb's whole body, past the argument parse.
 *
 * @param options the parsed invocation
 * @returns the process exit code
 */
async function runWalkAndPublish({ options }: { options: GithubWalkOptions }): Promise<number> {
  const { home, json } = options;
  const token = readExtensionToken({ home });
  if (token.isErr()) {
    for (const line of browserErrorLines({ error: token.error })) {
      process.stderr.write(`${line}\n`);
    }
    return EXIT_ERROR;
  }
  const pin = await resolveChromePin({
    home,
    path: stateHomePaths({ home }).chromePin,
    profiles: recordedProfilePort(),
  });
  if (pin.isErr()) {
    process.stderr.write(`${pin.error.message}\n`);
    return EXIT_ERROR;
  }
  const paths = githubAtlasPaths({ home });
  const at = new Date().toISOString();
  const walked = await runWalk({ chromePinPath: pin.value, options, paths, token: token.value });
  if (walked.isErr()) {
    for (const line of walked.error) {
      process.stderr.write(`${line}\n`);
    }
    return EXIT_ERROR;
  }
  const published = publishGithubWebWalk({
    at,
    declaredRoutes: declaredRouteShapes(),
    origin: WEB_ORIGIN,
    paths,
    walk: walked.value,
  });
  if (published.isErr()) {
    for (const line of published.error) {
      process.stderr.write(`${line}\n`);
    }
    return EXIT_ERROR;
  }
  if (json) {
    logger.out({ line: JSON.stringify(published.value) });
    return 0;
  }
  for (const line of renderGithubWalk({ outcome: published.value })) {
    logger.out({ line });
  }
  return 0;
}

/** `slopweaver atlas github walk` — fill the browser surface from the owner's own Chrome. */
export const githubAtlasWalkCommand = defineCommand({
  run: async (argv: readonly string[]): Promise<number> => {
    const options = parseGithubWalkOptions({
      defaultHome: slopweaverHome(),
      rest: verbTail({ argv, at: VERB_DEPTH, verbs: ["walk"] }),
    });
    if (options.isErr()) {
      for (const line of options.error) {
        process.stderr.write(`${line}\n`);
      }
      process.stderr.write(`${GITHUB_WALK_USAGE}\n`);
      return EXIT_USAGE;
    }
    return runWalkAndPublish({ options: options.value });
  },
});

/**
 * The two `atlas linear` verbs that read Linear, `sync` and `walk`, one command each, dispatched by the
 * registry rows in `atlas/linear/registration.ts`. The other two, `report` and `reset`, touch only the
 * published generation and live in `./linearGenerationRun.ts`.
 *
 * `sync` fills the API surface and, unless told not to, the browser surface in the same run; `walk` runs
 * the same path as `sync` (`runSyncOrWalk`) — it reads and publishes the API surface before the browser
 * half, and differs only in the usage line it prints.
 *
 * ## `sync` is the door
 *
 * Doctrine rule 3 says every Linear read goes through the `slopweaver` verbs, and that a verb driving a
 * browser IS the door. This is that verb: the API half goes through the one shared Linear transport, and the
 * browser half drives the owner's own Chrome through `browser/playwrightCli.ts` under the transport's
 * navigate-and-observe contract. Nothing here opens a second profile or launches a browser.
 *
 * ## Why the browser half never fails the run
 *
 * A relay that will not attach is a fact about this machine, and an API surface that read perfectly is
 * still worth publishing. So a browser failure becomes a `browser-surface-unreadable` coverage cell and a
 * gap, the generation is published with the API half filled, and the exit code stays 0 — while the summary
 * says in as many words which surfaces contributed. A run that threw away a good schema read because Chrome
 * was unreachable would be the opposite of honest about its own coverage.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type LinearApiSurfaceReading, readLinearApiSurface } from "../../../atlas/linear/apiSurface.js";
import { observationsFromResponses } from "../../../atlas/linear/graphqlObservations.js";
import type { LinearBrowserReading } from "../../../atlas/linear/projectionKit.js";
import { LINEAR_WEB_ORIGIN, type LinearPlannedPage, planLinearPages } from "../../../atlas/linear/routes.js";
import { linearAtlasPaths } from "../../../atlas/linear/store.js";
import { artifactWriterFor, type LinearSyncSummary, syncLinearAtlas } from "../../../atlas/linear/sync.js";
import { walkLinearSettings } from "../../../atlas/linear/walk.js";
import { readExtensionToken } from "../../../browser/extensionToken.js";
import type { BrowserPageTransport } from "../../../browser/pageTransport.js";
import { createPlaywrightCliTransport } from "../../../browser/playwrightCli.js";
import { resolveChromePin } from "../../../browser/profilePin.js";
import { type RecordedProfileHome, recordedProfilePort } from "../../../browser/recordedProfile.js";
import { realRelayLeaseWait } from "../../../browser/relayLease.js";
import { linearToken } from "../../../config.js";
import { sharedLinearTransport } from "../../../corpus/linear/transport.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome, verbTail } from "../../optionParsers.js";
import { type AtlasCommandError, AtlasCommandErrors, atlasCommandErrorLines } from "./errors.js";
import {
  LINEAR_VERB_INDEX,
  LINEAR_VERB_USAGE,
  noBrowserReading,
  parsed,
  renderSyncSummary,
  workspaceShape,
} from "./linearCore.js";
import { printErrors } from "./linearGenerationRun.js";

/**
 * Build the transport that drives the owner's own Chrome, or say why it cannot be built.
 *
 * Two dependencies, and each refusal names itself. The consent token is what lets the walk run without a
 * dialog asking whether to expose every signed-in session. The Chrome pin is what makes the extension's
 * connect page open in the owner's WORK profile rather than in whichever profile happens to be in front, and it is
 * a required dependency of the transport rather than a nicety.
 *
 * @param home the state home holding both
 * @param scratchDir where the transport writes its own screenshots
 * @param profiles the door the recorded work profile is read through
 * @returns the transport, or why it could not be made
 */
async function attachTransport({
  home,
  scratchDir,
  profiles,
}: RecordedProfileHome & { scratchDir: string }): Promise<Result<BrowserPageTransport, AtlasCommandError>> {
  const token = readExtensionToken({ home });
  if (token.isErr()) {
    return err(AtlasCommandErrors.linearBrowserTokenMissing());
  }
  const pin = await resolveChromePin({ home, path: stateHomePaths({ home }).chromePin, profiles });
  if (pin.isErr()) {
    return err(AtlasCommandErrors.chromePinUnresolved({ detail: pin.error.message }));
  }
  return ok(
    createPlaywrightCliTransport({
      deps: {
        chromePinPath: pin.value,
        extensionToken: token.value,
        home,
        leaseWait: realRelayLeaseWait(),
        nowIso: () => new Date().toISOString(),
        origins: [LINEAR_WEB_ORIGIN],
        platform: "linear",
        scratchDir,
      },
    }),
  );
}

/** Drive the walk, or say in one sentence why the browser surface holds nothing this run. */
async function fillBrowserSurface({
  pages,
  directory,
  home,
  json,
  limit,
  profiles,
}: RecordedProfileHome & {
  pages: readonly LinearPlannedPage[];
  directory: string;
  json: boolean;
  limit: number | null;
}): Promise<LinearBrowserReading> {
  const scratchDir = mkdtempSync(join(tmpdir(), "slopweaver-linear-walk-"));
  const attached = await attachTransport({ home, profiles, scratchDir });
  if (attached.isErr()) {
    return noBrowserReading({ because: attached.error.message });
  }
  try {
    const walked = await walkLinearSettings({
      pages,
      transport: attached.value,
      writeArtifact: artifactWriterFor({ directory }),
      ...(limit === null ? {} : { limit }),
      ...(json
        ? {}
        : {
            progress: ({ line }: { line: string }): void => {
              process.stderr.write(`${line}\n`);
            },
          }),
    });
    if (walked.isErr()) {
      return noBrowserReading({ because: walked.error.join("; ") });
    }
    const reachedAny = walked.value.pages.some((page) => page.outcome !== "not-attempted");
    return {
      limited: limit !== null,
      observations: observationsFromResponses({ responses: walked.value.responses }),
      pages: walked.value.pages,
      unavailableBecause: reachedAny
        ? null
        : "the Playwright Extension relay never reached a page, so no settings route was attempted",
    };
  } catch (error: unknown) {
    return noBrowserReading({ because: `the browser walk could not start: ${errorMessage({ error })}` });
  } finally {
    rmSync(scratchDir, { force: true, recursive: true });
  }
}

/** What a `sync`/`walk` invocation resolved to, once its flags were parsed and its credential found. */
interface SyncPlan {
  readonly home: string;
  readonly json: boolean;
  readonly limit: number | null;
  readonly skipBrowser: boolean;
  readonly token: string;
}

/** Parse the shared flags for `sync`/`walk`, or say why the invocation cannot run. */
function planSync({
  argv,
  verb,
}: {
  argv: readonly string[];
  verb: "sync" | "walk";
}): Result<SyncPlan, AtlasCommandError> {
  const { parsedFlags } = parsed({ argv, verb });
  if (parsedFlags.isErr()) {
    return err(AtlasCommandErrors.linearPlanInvalid({ problems: parsedFlags.error, usage: LINEAR_VERB_USAGE[verb] }));
  }
  const { values, flags } = parsedFlags.value;
  const limit = parseLinearLimit({ raw: values["limit"] });
  if (limit.isErr()) {
    return err(limit.error);
  }
  const home = resolveHome({ named: values["home"] });
  const token = linearToken({ home });
  if (token === undefined) {
    return err(AtlasCommandErrors.linearApiKeyMissing());
  }
  return ok({ home, json: flags.has("json"), limit: limit.value, skipBrowser: flags.has("skip-browser"), token });
}

/**
 * Read a `--limit` value: `null` when the flag is absent, otherwise the base-10 `Number.parseInt` of it, which
 * reads a leading run of digits and drops the rest (`"2x"` reads as `2`, `"1.5"` as `1`). Refuses a value
 * whose parse is not a number, or is below 1.
 *
 * @param raw the flag's value as typed, or `undefined` when the flag was not passed
 * @returns the page limit, `null` for none, or `LINEAR_LIMIT_INVALID`
 * @internal
 */
export function parseLinearLimit({ raw }: { raw: string | undefined }): Result<number | null, AtlasCommandError> {
  const limit = raw === undefined ? null : Number.parseInt(raw, 10);
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    return err(AtlasCommandErrors.linearLimitInvalid());
  }
  return ok(limit);
}

/** Print what one run came to, in whichever shape the caller asked for. */
function reportSync({
  api,
  browser,
  json,
  pages,
  summary,
}: {
  api: LinearApiSurfaceReading;
  browser: LinearBrowserReading;
  json: boolean;
  pages: number;
  summary: LinearSyncSummary;
}): void {
  if (json) {
    logger.out({
      line: JSON.stringify(
        {
          ...summary,
          api: { introspectionBatches: api.introspectionBatches, schemaFingerprint: api.schemaFingerprint },
          browserUnavailableBecause: browser.unavailableBecause,
          plannedPages: pages,
        },
        null,
        2,
      ),
    });
    return;
  }
  renderSyncSummary({ input: summary }).forEach((line) => {
    logger.out({ line });
  });
  if (browser.unavailableBecause !== null) {
    logger.out({ line: `  browser surface NOT filled: ${browser.unavailableBecause}` });
  }
}

/** Run `sync`, and `walk` — which is `sync` with the browser half named in the verb. */
async function runSyncOrWalk({ argv, verb }: { argv: readonly string[]; verb: "sync" | "walk" }): Promise<number> {
  const rest = verbTail({ argv, at: LINEAR_VERB_INDEX, verbs: [verb] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: LINEAR_VERB_USAGE[verb] });
    return EXIT_OK;
  }
  const plan = planSync({ argv, verb });
  if (plan.isErr()) {
    printErrors({ errors: atlasCommandErrorLines({ error: plan.error }) });
    return EXIT_USAGE;
  }
  const { home, json, limit, skipBrowser, token } = plan.value;
  const paths = linearAtlasPaths({ home });
  const api = await readLinearApiSurface({ request: sharedLinearTransport({ token }).request });
  if (api.isErr()) {
    logger.error({ msg: api.error.message });
    return EXIT_ERROR;
  }
  const shape = workspaceShape({ api: api.value });
  const pages = shape.urlKey === null ? [] : planLinearPages({ teamKeys: shape.teamKeys, urlKey: shape.urlKey });
  const profiles = recordedProfilePort();
  const browser: LinearBrowserReading = skipBrowser
    ? noBrowserReading({ because: "--skip-browser was passed, so the browser surface was not attempted this run" })
    : await fillBrowserSurface({ directory: paths.directory, home, json, limit, pages, profiles });

  const summary = syncLinearAtlas({
    api: api.value,
    at: new Date().toISOString(),
    browser,
    paths,
    plannedCount: pages.length,
    workspaceUrlBase: shape.urlKey === null ? null : `${LINEAR_WEB_ORIGIN}/${shape.urlKey}`,
  });
  if (summary.isErr()) {
    printErrors({ errors: summary.error });
    return EXIT_ERROR;
  }
  reportSync({ api: api.value, browser, json, pages: pages.length, summary: summary.value });
  return EXIT_OK;
}

/**
 * `atlas linear sync` — the API surface and, unless told not to, the browser surface in one run.
 *
 * @internal
 */
export const linearSyncCommand = defineCommand({ run: (argv) => runSyncOrWalk({ argv, verb: "sync" }) });

/**
 * `atlas linear walk` — the same run as `sync`: it reads and publishes the API surface, then the browser
 * surface in the owner's own Chrome unless `--skip-browser` is passed.
 *
 * @internal
 */
export const linearWalkCommand = defineCommand({ run: (argv) => runSyncOrWalk({ argv, verb: "walk" }) });

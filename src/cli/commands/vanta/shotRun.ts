/**
 * `slopweaver atlas vanta shot --control <id> [--control <id>…] [--json] [--home <dir>]` — photograph one
 * named control in the owner's own Chrome, and record the address it was reached at.
 *
 * ## Why this verb exists beside `walk`
 *
 * `walk` fills the twelve declared navigation surfaces, and a photograph of the controls INDEX proves
 * nothing about one control — a reader shown the list has been shown that a list exists. An ISO answer
 * cites a control, so its evidence has to be a picture of that control. An answer
 * showing several quick wins shows at least a few screenshots.
 *
 * Targeted rather than exhaustive, because the cost is their browser: one page costs about 7.7 seconds
 * end to end (`browser/playwrightCli.ts`), and a tenant holds hundreds of controls (MEASURED
 * — `slopweaver atlas vanta read --kind control --json`). An answer needs two or
 * three of them.
 *
 * ## Everything here is the effects; every decision is `atlas/vanta/controlShot.ts`'s
 *
 * Resolving what the caller typed against the atlas's own control set, choosing the pages, pairing the
 * observations back and deciding what a shot may claim are all pure and tested over a fake. What is here is
 * reading the store, binding the transport that attaches to their browser, and printing.
 *
 * ## What makes this read-only is construction, not the door guard
 *
 * The same property `walkRun.ts` states, and for the same reason: the snippet has its whole call set
 * written there — `goto`, `waitForTimeout`, `$$eval` for hrefs, `screenshot`, `bringToFront`, `title` and
 * `url` — every one a read, save the tab activation a wedged capture needs; the interpolated values vary,
 * never a call.
 *
 * That set is stated verbatim in several walk modules, and a guarantee repeated in several places is one
 * that can quietly stop being true in one of them: `$$eval` had been in the snippet for days while every
 * copy still named five calls. Verified against the snippet itself rather than copied from a sibling —
 * `grep -nE 'page\.(goto|waitForTimeout|\$\$eval|screenshot|bringToFront|title|url)\(' src/browser/pageVisitSnippet.ts`.
 */

import { verifiedArtifactWriter } from "../../../atlas/kit/artifactWriter.js";
import { attachTransportAt } from "../../../atlas/kit/walkTransport.js";
import { VANTA_WEB_ORIGIN, vantaTenantRootFromSlug } from "../../../atlas/vanta/browserPages.js";
import { walkVantaBrowser } from "../../../atlas/vanta/browserWalk.js";
import {
  type ResolvedVantaControl,
  resolveVantaControlIds,
  vantaControlLookup,
  vantaControlPages,
} from "../../../atlas/vanta/controlShot.js";
import { type VantaControlShotError, VantaControlShotErrors } from "../../../atlas/vanta/controlShotErrors.js";
import { publishVantaControlShot, type VantaControlShotOutcome } from "../../../atlas/vanta/controlShotSurface.js";
import { readVantaKindFile, type VantaAtlasPaths, vantaAtlasPaths } from "../../../atlas/vanta/store.js";
import { resolveVantaTenantSlug } from "../../../atlas/vanta/tenantSlug.js";
import { type RecordedProfilePort, recordedProfilePort } from "../../../browser/recordedProfile.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  collectRepeated,
  flagValue,
  flagValueOr,
  parseFlagTail,
  verbTail,
  withoutRepeated,
} from "../../optionParsers.js";

/** Where a Vanta verb sits: past the runtime, the script, the `atlas` noun and the `vanta` platform. */
const VANTA_VERB_INDEX = 4;

/**
 * The usage line this verb prints. Exported so a test can assert it equals the `shot` row's `usage` in
 * `atlas/vanta/registration.ts` — the verb's one registered usage, not a second hand-written copy.
 *
 * @internal
 */
export const VANTA_SHOT_USAGE =
  "usage: slopweaver atlas vanta shot --control <id> [--control <id>...] [--tenant <slug>] [--json] [--home <dir>]";

/**
 * Parse the flag tail this verb accepts.
 *
 * `--control` is repeatable, so it is collected and stripped before the single-value parser sees the tail —
 * otherwise a second occurrence reads as a duplicate flag rather than a second control.
 *
 * An EMPTY list is not refused here, and that is deliberate: `resolveVantaControlIds` already decides what
 * "you named no control" means and says so in one place, and {@link vantaShotCommand} branches on its
 * `NO_CONTROL_ASKED` code to answer the usage exit code. A second check here would be a second wording of
 * the same refusal, free to drift from the one that is tested.
 *
 * @param rest the argv tail past the verb
 * @returns the resolved home, the ids asked for, and whether to print JSON
 */
function parseShotOptions({ rest }: { rest: readonly string[] }): Result<{
  home: string;
  controls: readonly string[];
  tenant: string | null;
  json: boolean;
}> {
  const controls = collectRepeated({ name: "--control", rest });
  const parsed = parseFlagTail({
    rest: withoutRepeated({ name: "--control", rest }),
    spec: { boolean: ["json"], value: ["home", "tenant"] },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({
    controls,
    home: flagValueOr({ fallback: slopweaverHome(), name: "home", parsed: parsed.value }),
    json: parsed.value.flags.has("json"),
    tenant: flagValue({ name: "tenant", parsed: parsed.value }),
  });
}

/**
 * The tenant root to seed the walk with, or `null` to let it probe for one.
 *
 * A failure to resolve the slug is deliberately NOT an error: the probe is the fallback and it works. What
 * the slug buys is one fewer page load and one fewer thing to fail in front of the work — see
 * {@link ../../../atlas/vanta/browserWalk.js#vantaPageWalkSpec} for the retry that spent its whole budget on
 * tenant discovery.
 *
 * @param flag the `--tenant` value, or `null` when it was not passed
 * @param home the state home whose `secrets/` directory is the last route
 * @returns the tenant root, or `null` when no slug could be resolved
 */
function seededRootFor({ flag, home }: { flag: string | null; home: string }): string | null {
  const slug = resolveVantaTenantSlug({ env: process.env, flag, home });
  return slug.isErr() ? null : vantaTenantRootFromSlug({ tenantSlug: slug.value });
}

/**
 * Place every id the caller typed against the atlas's own control set.
 *
 * @param asked the ids the caller named
 * @param paths the resolved atlas paths
 * @returns the resolved controls, or why an id could not be placed
 */
function resolveAsked({
  asked,
  paths,
}: {
  asked: readonly string[];
  paths: VantaAtlasPaths;
}): Result<readonly ResolvedVantaControl[], VantaControlShotError> {
  const stored = readVantaKindFile({ kind: "control", paths });
  if (stored.isErr()) {
    return err(VantaControlShotErrors.controlSetUnreadable({ reasons: stored.error }));
  }
  // An atlas that has never synced has no control file at all, which resolveVantaControlIds reports as
  // ATLAS_HOLDS_NO_CONTROLS — the same answer as a file holding none, and the right one either way.
  const entities = stored.value === null ? [] : stored.value.entities;
  return resolveVantaControlIds({ asked, rows: vantaControlLookup({ entities }) });
}

/**
 * Photograph every named control.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function vantaShotCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: VANTA_VERB_INDEX, verbs: ["shot"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: VANTA_SHOT_USAGE });
    return EXIT_OK;
  }
  const options = parseShotOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: VANTA_SHOT_USAGE });
    return EXIT_USAGE;
  }
  const { home, controls: asked, json: asJson, tenant } = options.value;
  const atlas = vantaAtlasPaths({ home });
  const controls = resolveAsked({ asked, paths: atlas });
  if (controls.isErr()) {
    // NO_CONTROL_ASKED is the one failure the caller fixes on the command line rather than in the atlas, so
    // it answers the usage code and prints the usage line beside it; every other kind is a state fault.
    if (controls.error.code === "NO_CONTROL_ASKED") {
      logger.error({ msg: controls.error.message });
      logger.error({ msg: VANTA_SHOT_USAGE });
      return EXIT_USAGE;
    }
    return refuse({ lines: [controls.error.message] });
  }
  const captured = await capture({
    asJson,
    atlas,
    controls: controls.value,
    home,
    profiles: recordedProfilePort(),
    seededRoot: seededRootFor({ flag: tenant, home }),
  });
  if (captured.isErr()) {
    return refuse({ lines: captured.error });
  }
  report({ asJson, controls: controls.value, outcome: captured.value });
  // A shot that photographed nothing it was asked for is a failed capture, not a quiet success: the whole
  // point of the verb is the evidence, and a caller scripting it must be able to branch on that.
  return captured.value.heldCount === 0 ? EXIT_ERROR : EXIT_OK;
}

/** Print every reason this invocation is going no further, and answer the exit code that says so. */
function refuse({ lines }: { lines: readonly string[] }): number {
  for (const line of lines) {
    logger.error({ msg: line });
  }
  return EXIT_ERROR;
}

/**
 * Attach to the owner's own Chrome, photograph every resolved control, and publish what came back.
 *
 * The transport is released before anything is published, so a publish failure never leaves a tab open in
 * their browser.
 *
 * @param controls the controls to photograph, already placed against the atlas
 * @param atlas the resolved atlas paths
 * @param home the state home the token and the recorded profile live under
 * @param asJson whether the caller asked for JSON, which is what suppresses the progress lines
 * @param profiles the door the recorded work profile is read through
 * @param seededRoot a tenant root already known, so the discovery navigation is skipped
 * @returns what was published, or every reason it was not
 */
async function capture({
  controls,
  atlas,
  home,
  asJson,
  profiles,
  seededRoot,
}: {
  controls: readonly ResolvedVantaControl[];
  atlas: VantaAtlasPaths;
  home: string;
  asJson: boolean;
  profiles: RecordedProfilePort;
  seededRoot: string | null;
}): Promise<Result<VantaControlShotOutcome>> {
  // The walk's own attach: the token, the profile pin and the lease, so a missing pin stops the run BEFORE Chrome
  // launches (`browser/profilePin.ts`), with the atlas's artifact directory as the client's scratch.
  const attached = await attachTransportAt({
    home,
    origins: [VANTA_WEB_ORIGIN],
    platform: "vanta",
    profiles,
    scratchDir: atlas.pageArtifacts,
  });
  if (attached.isErr()) {
    return err(attached.error);
  }
  const transport = attached.value;
  const walked = await walkVantaBrowser({
    pages: vantaControlPages({ controls }),
    seededRoot,
    transport,
    writeArtifact: verifiedArtifactWriter({ directory: atlas.directory }),
    ...(asJson
      ? {}
      : {
          progress: ({ line }) => {
            logger.error({ msg: line });
          },
        }),
  });
  await transport.release();
  if (walked.isErr()) {
    return err(walked.error);
  }
  return publishVantaControlShot({ at: new Date().toISOString(), controls, paths: atlas, walk: walked.value });
}

/** Print what the shot captured, as JSON or as one line per control. */
function report({
  asJson,
  controls,
  outcome,
}: {
  asJson: boolean;
  controls: readonly ResolvedVantaControl[];
  outcome: VantaControlShotOutcome;
}): void {
  if (asJson) {
    // Every field here is the caller's own input or this atlas's own id — the tenant slug reaches only the
    // stored generation, never this report. See `browserPages.ts`.
    logger.out({
      line: JSON.stringify(
        {
          controls: controls.map((one) => ({
            externalId: one.externalId,
            name: one.name,
            providerId: one.providerId,
          })),
          published: outcome,
        },
        null,
        1,
      ),
    });
    return;
  }
  logger.out({
    line: `vanta control shot — ${String(outcome.heldCount)} of ${String(outcome.askedCount)} control page(s) reached and photographed`,
  });
  for (const control of controls) {
    const unheld = outcome.unheld.find((one) => one.providerId === control.providerId);
    const because = unheld === undefined ? null : unheld.because;
    const label = control.externalId === null ? control.providerId : `${control.externalId} (${control.providerId})`;
    const verdict = because === null ? "photographed" : `NOT HELD — ${because}`;
    logger.out({ line: `  ${label}: ${verdict}` });
  }
}

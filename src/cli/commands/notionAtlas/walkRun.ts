/**
 * `slopweaver atlas notion walk [--json] [--home <dir>]` — fill the atlas's BROWSER surface by walking every
 * page `browserPages.ts` declares, in the owner's own Chrome, photographing each — and then every settings
 * TAB `settingsTabs.ts` declares, through the settings transport, since the settings surface has no route.
 *
 * The two halves run one after the other, each on its own transport, because both take the machine's one
 * relay lease. The tabs cost one modal open apiece (`atlas/notion/settingsWalk.ts`), so a walk takes that much
 * longer than the routes alone; `refresh` runs this verb, so the nightly resync fills both halves.
 *
 * The walk, the page inventory, the reduction and the gap judgement are the domain's, and each is written
 * against the transport SEAM, so all of them are settled by unit tests over a fake. What is here is the
 * effects: resolving the consent token the owner provisioned, binding the transport that attaches to the owner's
 * browser, and the writer that proves each screenshot landed.
 *
 * ## What makes this read-only is construction, not the door guard
 *
 * `src/admit/browserSurface.ts` matches `mcp__claude-in-chrome__*` tool calls, so it does not see this path
 * at all. What holds the property is the snippet in `browser/playwrightCli.ts`, whose every statement is
 * written there and whose whole call set is `goto`, `waitForTimeout`, `$$eval` for hrefs, `screenshot`,
 * `bringToFront`, `title` and `url` — every one a read, save the tab activation a wedged capture needs
 * (`playwrightCli.ts`); the interpolated values vary, never a call. Playwright separates reading a page
 * from acting on one at the API, which the `computer` tool — where `screenshot` and `type` are the same
 * call — cannot. That is a stronger guarantee than the guard offers, and it is stated here rather than
 * claimed as coverage. The settings half does click, and only disclosures: `browser/notionSettings.ts` carries
 * that argument — the switcher, its `Settings` item, and a `role="tab"` from a closed list.
 *
 * ## No URL is ever printed, in either report shape
 *
 * A Notion URL carries the workspace slug, which is the organisation's own name. Both the human report and
 * `--json` name the declared SURFACE and its outcome and never the address, so redirecting this verb's
 * output into a file cannot put a private identifier somewhere it does not belong. The sibling Vanta verb
 * claims its tenant root never leaves the process while serialising every requested and final URL under
 * `--json`; that is the shape being avoided rather than copied.
 */
import { readFileSync, rmSync } from "node:fs";

import { verifiedArtifactWriter } from "../../../atlas/kit/artifactWriter.js";
import { attachWalkTransport, relayDepsFor } from "../../../atlas/kit/walkTransport.js";
import {
  NOTION_MARKETING_ORIGIN,
  NOTION_SO_WEB_ORIGIN,
  NOTION_WEB_ORIGIN,
} from "../../../atlas/notion/browserPages.js";
import { type NotionBrowserSurfaceOutcome, publishNotionBrowserWalk } from "../../../atlas/notion/browserSurface.js";
import { type NotionPageObservation, walkNotionBrowser } from "../../../atlas/notion/browserWalk.js";
import { type NotionSettingsSurfaceOutcome, publishNotionSettingsTabs } from "../../../atlas/notion/settingsSurface.js";
import {
  isSettingsTabHeld,
  type NotionSettingsTabObservation,
  type NotionSettingsWalkResult,
  walkNotionSettingsTabs,
} from "../../../atlas/notion/settingsWalk.js";
import { type NotionAtlasPaths, notionAtlasPaths } from "../../../atlas/notion/store.js";
import { createNotionSettingsTransport } from "../../../browser/notionSettings.js";
import { type RecordedProfilePort, recordedProfilePort } from "../../../browser/recordedProfile.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a Notion atlas verb sits: past the runtime, the script, the `atlas` noun and the `notion` platform. */
const NOTION_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const NOTION_WALK_USAGE = "usage: slopweaver atlas notion walk [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseWalkOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/**
 * One page's row. Names the declared surface and what became of it — never its URL.
 *
 * @param page the observation to render
 * @returns the line, carrying the verdict, the call and body counts, and every reason the page is not held
 *
 * @internal
 */
export function pageLine({ page }: { page: NotionPageObservation }): string {
  const reach = pageVerdict({ page });
  const counts = `${String(page.responseAccounting.bodySucceeded)} kept / ${String(page.responseAccounting.eligible)} eligible`;
  const why = page.unreachableBecause === null ? "" : ` — ${page.unreachableBecause}`;
  const shot = page.screenshotMissingBecause === null ? "" : ` — ${page.screenshotMissingBecause}`;
  return `  ${page.surface.padEnd(28)} ${reach.padEnd(14)} ${String(page.calls.length)} call(s), ${counts}${why}${shot}`;
}

/** The one word a page's row leads with. */
function pageVerdict({ page }: { page: NotionPageObservation }): string {
  if (!page.attempted) {
    return "NOT-ATTEMPTED";
  }
  if (page.unreachableBecause !== null) {
    return "UNREACHABLE";
  }
  return page.screenshotMissingBecause === null ? "held" : "NO-SCREENSHOT";
}

/** What the `--json` shape carries: the surface and its verdict, with every URL deliberately absent. */
function jsonPage({ page }: { page: NotionPageObservation }): Record<string, unknown> {
  return {
    attempted: page.attempted,
    callCount: page.calls.length,
    captureComplete: page.captureComplete,
    redirected: page.redirected,
    responseAccounting: page.responseAccounting,
    screenshotMissingBecause: page.screenshotMissingBecause,
    statusCode: page.statusCode,
    surface: page.surface,
    unreachableBecause: page.unreachableBecause,
  };
}

/**
 * One settings tab's row. Names the tab and what became of it — a tab has no URL to leak.
 *
 * @param tab the observation to render
 * @returns the line, carrying the verdict and every reason the tab is not held
 *
 * @internal
 */
export function tabLine({ tab }: { tab: NotionSettingsTabObservation }): string {
  const why = tab.notRenderedBecause === null ? "" : ` — ${tab.notRenderedBecause}`;
  const shot =
    tab.notRenderedBecause === null && tab.screenshotMissingBecause !== null
      ? ` — ${tab.screenshotMissingBecause}`
      : "";
  return `  ${tab.surface.padEnd(28)} ${tabVerdict({ tab })}${why}${shot}`;
}

/** The one word a tab's row leads with. */
function tabVerdict({ tab }: { tab: NotionSettingsTabObservation }): string {
  if (!tab.attempted) {
    return "NOT-ATTEMPTED";
  }
  if (tab.notRenderedBecause !== null) {
    return "NOT-RENDERED";
  }
  return isSettingsTabHeld({ tab }) ? "held" : "NO-SCREENSHOT";
}

/** What the `--json` shape carries for one tab. */
function jsonTab({ tab }: { tab: NotionSettingsTabObservation }): Record<string, unknown> {
  return {
    attempted: tab.attempted,
    held: isSettingsTabHeld({ tab }),
    notRenderedBecause: tab.notRenderedBecause,
    screenshotMissingBecause: tab.screenshotMissingBecause,
    selectionVerified: tab.selectionVerified,
    surface: tab.surface,
    tabMatches: tab.tabMatches,
  };
}

/** Print what the walk published, as JSON or as one line per declared page and per declared tab. */
function report({
  asJson,
  outcome,
  pages,
  settings,
}: {
  asJson: boolean;
  outcome: NotionBrowserSurfaceOutcome;
  pages: readonly NotionPageObservation[];
  settings: SettingsPass;
}): void {
  if (asJson) {
    logger.out({
      line: JSON.stringify(
        {
          pages: pages.map((page) => jsonPage({ page })),
          published: outcome,
          settingsPublished: settings.outcome,
          settingsTabs: settings.tabs.map((tab) => jsonTab({ tab })),
        },
        null,
        1,
      ),
    });
    return;
  }
  logger.out({
    line:
      `notion browser walk — ${String(outcome.reachedCount)} of ${String(outcome.declaredCount)} declared page(s) ` +
      `reached, ${String(outcome.photographedCount)} photographed, ` +
      `${String(outcome.operationCount)} distinct operation(s) published`,
  });
  for (const page of pages) {
    logger.out({ line: pageLine({ page }) });
  }
  logger.out({
    line:
      `notion settings tabs — ${String(settings.outcome.heldCount)} of ${String(settings.outcome.declaredCount)} ` +
      `declared tab(s) shown and photographed`,
  });
  for (const tab of settings.tabs) {
    logger.out({ line: tabLine({ tab }) });
  }
}

/**
 * Run the Notion browser walk.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function notionAtlasWalkCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: NOTION_VERB_INDEX, verbs: ["walk"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: NOTION_WALK_USAGE });
    return EXIT_OK;
  }
  const options = parseWalkOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: NOTION_WALK_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  const paths = notionAtlasPaths({ home });
  const profiles = recordedProfilePort();
  const attached = await attachWalkTransport({
    directory: paths.directory,
    home,
    origins: [NOTION_WEB_ORIGIN, NOTION_SO_WEB_ORIGIN, NOTION_MARKETING_ORIGIN],
    platform: "notion",
    profiles,
  });
  if (attached.isErr()) {
    return failedWith({ lines: attached.error });
  }
  const transport = attached.value;
  const walked = await walkNotionBrowser({
    progress: ({ line }) => {
      logger.error({ msg: line });
    },
    transport,
    writeArtifact: verifiedArtifactWriter({ directory: paths.directory }),
  });
  await transport.release();
  if (walked.isErr()) {
    return failedWith({ lines: walked.error });
  }
  const published = publishNotionBrowserWalk({ at: new Date().toISOString(), paths, walk: walked.value });
  if (published.isErr()) {
    return failedWith({ lines: published.error });
  }
  // The routes' transport is released above, and only then is the settings one built: both take the
  // machine's one relay lease, which a second holder in the same process is refused at once, without waiting.
  const settings = await walkAndPublishSettings({ home, paths, profiles });
  if (settings.isErr()) {
    return failedWith({ lines: settings.error });
  }
  report({ asJson, outcome: published.value, pages: walked.value.pages, settings: settings.value });
  return EXIT_OK;
}

/** Print every reason a step failed, and answer the exit code that says so. */
function failedWith({ lines }: { lines: readonly string[] }): number {
  lines.forEach((line) => {
    logger.error({ msg: line });
  });
  return EXIT_ERROR;
}

/** What the settings half of a walk came to: the tabs it captured and what publishing them did. */
interface SettingsPass {
  readonly tabs: readonly NotionSettingsTabObservation[];
  readonly outcome: NotionSettingsSurfaceOutcome;
}

/**
 * Read one scratch screenshot the settings transport wrote, then remove it — kept or not, because nothing
 * else ever deletes one.
 *
 * @param path the scratch PNG
 * @returns its bytes, or why they could not be read
 */
function readAndRemoveShot({ path }: { path: string }): Result<Uint8Array> {
  try {
    return ok(new Uint8Array(readFileSync(path)));
  } catch (error) {
    return err([`could not read the scratch screenshot: ${error instanceof Error ? error.message : String(error)}`]);
  } finally {
    rmSync(path, { force: true });
  }
}

/**
 * Capture every declared settings tab in the owner's own Chrome, and publish them beside the routes.
 *
 * @param home the state home the relay lease and consent token live under
 * @param paths the resolved atlas paths
 * @param profiles the door the recorded work profile is read through
 * @returns the tabs and what was published, or why the settings half could not run
 */
async function walkAndPublishSettings({
  home,
  paths,
  profiles,
}: {
  home: string;
  paths: NotionAtlasPaths;
  profiles: RecordedProfilePort;
}): Promise<Result<SettingsPass>> {
  const deps = await relayDepsFor({
    directory: paths.directory,
    home,
    origins: [NOTION_WEB_ORIGIN, NOTION_SO_WEB_ORIGIN, NOTION_MARKETING_ORIGIN],
    platform: "notion",
    profiles,
  });
  if (deps.isErr()) {
    return err(deps.error);
  }
  const transport = createNotionSettingsTransport({ deps: deps.value, url: NOTION_WEB_ORIGIN });
  let walked: NotionSettingsWalkResult;
  try {
    // The arms are synchronous, so the bounded wait for a live holder happens here, once, before the first. A
    // wait that never got the lease STOPS the session, so every arm below refuses with it at once and the
    // settings walk records that failure exactly as it records any other stopped relay.
    const held = await transport.lease();
    if (held.isErr()) {
      logger.error({ msg: held.error.message });
    }
    walked = walkNotionSettingsTabs({
      now: () => new Date().toISOString(),
      progress: ({ line }) => {
        logger.error({ msg: line });
      },
      readShot: readAndRemoveShot,
      transport,
      writeArtifact: verifiedArtifactWriter({ directory: paths.directory }),
    });
  } finally {
    transport.release();
  }
  const published = publishNotionSettingsTabs({ at: new Date().toISOString(), paths, walk: walked });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({ outcome: published.value, tabs: walked.tabs });
}

/**
 * `slopweaver atlas notion settings [--tab <id>] [--json] [--home <dir>]` — open Notion's settings modal in
 * the owner's own Chrome and report what it holds.
 *
 * ## Why this verb exists beside `walk`
 *
 * `walk` fills the browser surface from a DECLARED list, which is what makes its coverage claim checkable.
 * This verb is how that list is measured in the first place, and re-measured when Notion renames a tab: with
 * no `--tab` it opens the modal and prints every navigation entry the client offered, and with one it selects
 * that tab and reports what the client then marked selected. Notion documents no URL scheme and no tab list
 * anywhere, so there is no other source for the inventory — and a declared list written from memory is the
 * failure this atlas already shipped once (`atlas/notion/browserPages.ts`).
 *
 * ## No URL and no workspace slug is ever printed, in either report shape
 *
 * A Notion URL carries the workspace segment, which is the organisation's own name. Both shapes carry the
 * tab NAMES the client renders and the outcome, never an address — the same rule `walkRun.ts` holds, for the
 * same reason.
 */
import { relayDepsFor } from "../../../atlas/kit/walkTransport.js";
import {
  NOTION_MARKETING_ORIGIN,
  NOTION_SO_WEB_ORIGIN,
  NOTION_WEB_ORIGIN,
} from "../../../atlas/notion/browserPages.js";
import { NOTION_SETTINGS_TAB_IDS, notionSettingsTab } from "../../../atlas/notion/settingsTabs.js";
import { notionAtlasPaths } from "../../../atlas/notion/store.js";
import { createNotionSettingsTransport, type NotionSettingsObservation } from "../../../browser/notionSettings.js";
import { recordedProfilePort } from "../../../browser/recordedProfile.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, verbTail } from "../../optionParsers.js";

/** Where a Notion atlas verb sits: past the runtime, the script, the `atlas` noun and the `notion` platform. */
const NOTION_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const NOTION_SETTINGS_USAGE = "usage: slopweaver atlas notion settings [--tab <id>] [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseSettingsOptions({
  rest,
}: {
  rest: readonly string[];
}): Result<{ home: string; json: boolean; tab: string | null }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "tab"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { home = slopweaverHome(), tab = null } = parsed.value.values;
  return ok({ home, json: parsed.value.flags.has("json"), tab });
}

/**
 * Which tab names the run will ask for, or `null` for the observe arm.
 *
 * Resolved before the browser is touched, so an unknown `--tab` costs nothing and refuses by naming the
 * closed set rather than by opening the owner's Chrome and finding nothing to click.
 *
 * @param tab the `--tab` value, or `null` when none was given
 * @returns the names for the tab arm, `null` for the observe arm, or why neither
 */
function resolveTabNames({ tab }: { tab: string | null }): Result<readonly string[] | null> {
  if (tab === null) {
    return ok(null);
  }
  const found = notionSettingsTab({ id: tab });
  if (found.isErr()) {
    return err(found.error);
  }
  return ok(found.value.names);
}

/**
 * The human report: what the modal was, and every entry it offered.
 *
 * @param observed what the arm saw
 * @param tab the tab id that was asked for, or `null` when the modal was only observed
 * @returns the lines to print, in order
 *
 * @internal
 */
export function settingsLines({
  observed,
  tab,
}: {
  observed: NotionSettingsObservation;
  tab: string | null;
}): readonly string[] {
  if (observed.refused !== null) {
    return [
      `notion settings — REFUSED: ${observed.refused}`,
      `  the sidebar offered ${String(observed.offered.length)} named control(s):`,
      ...observed.offered.map((name) => `    ${name}`),
    ];
  }
  const opened = observed.dialogOpen ? "open" : "NOT OPEN";
  const asked = tab === null ? "observed only" : `asked for ${tab}`;
  const got =
    observed.selectedTabs.length === 0 ? "nothing marked selected" : `selected ${observed.selectedTabs.join(", ")}`;
  const head = `notion settings — modal ${opened}, ${asked}, ${got}, ${String(observed.entries.length)} entry(s)`;
  const trouble = observed.dialogError === null ? [] : [`  could not act: ${observed.dialogError}`];
  const census = observed.dialogOpen ? [] : [`  roles on the page after the click: ${observed.roles.join(" ")}`];
  return [
    head,
    ...trouble,
    ...census,
    ...observed.entries.map((entry) => `  ${entry.selected ? "*" : " "} ${entry.name.padEnd(34)} ${entry.role}`),
  ];
}

/**
 * Open Notion's settings modal and report it.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function notionAtlasSettingsCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: NOTION_VERB_INDEX, verbs: ["settings"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: NOTION_SETTINGS_USAGE });
    logger.out({ line: `  --tab is one of: ${NOTION_SETTINGS_TAB_IDS.join(", ")}` });
    return EXIT_OK;
  }
  const options = parseSettingsOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: NOTION_SETTINGS_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson, tab } = options.value;
  const resolved = resolveTabNames({ tab });
  if (resolved.isErr()) {
    resolved.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_USAGE;
  }
  const tabNames = resolved.value;
  const paths = notionAtlasPaths({ home });
  const profiles = recordedProfilePort();
  const deps = await relayDepsFor({
    directory: paths.directory,
    home,
    origins: [NOTION_WEB_ORIGIN, NOTION_SO_WEB_ORIGIN, NOTION_MARKETING_ORIGIN],
    platform: "notion",
    profiles,
  });
  if (deps.isErr()) {
    deps.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  const transport = createNotionSettingsTransport({ deps: deps.value, url: NOTION_WEB_ORIGIN });
  const seen = tabNames === null ? transport.observe() : transport.readTab({ tabNames });
  transport.release();
  if (seen.isErr()) {
    logger.error({ msg: `${seen.error.code}: ${seen.error.message}` });
    return EXIT_ERROR;
  }
  if (asJson) {
    logger.out({ line: JSON.stringify(jsonObservation({ observed: seen.value }), null, 1) });
    return EXIT_OK;
  }
  settingsLines({ observed: seen.value, tab }).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

/** The `--json` shape: every field but the address, which carries the workspace slug. */
function jsonObservation({ observed }: { observed: NotionSettingsObservation }): Record<string, unknown> {
  return {
    clicked: observed.clicked,
    controlMatches: observed.controlMatches,
    dialogError: observed.dialogError,
    dialogLabel: observed.dialogLabel,
    dialogOpen: observed.dialogOpen,
    entries: observed.entries,
    offered: observed.offered,
    overlays: observed.overlays,
    refused: observed.refused,
    roles: observed.roles,
    screenshotError: observed.screenshotError,
    selectedTabs: observed.selectedTabs,
    tabMatches: observed.tabMatches,
    title: observed.title,
  };
}

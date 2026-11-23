/**
 * Walk every settings tab `settingsTabs.ts` declares, photograph each, and grade whether the client showed it.
 *
 * ## A tab is not a page, so it gets its own observation
 *
 * `browserWalk.ts`'s `NotionPageObservation` is shaped by navigation: a requested URL, a settled URL, a status code and
 * the response accounting of what the client fetched. A settings tab has none of those — Notion's settings
 * surface has no address, which a walk of the declared routes in `browserPages.ts` measured — and is reached by
 * CLICKS inside one modal (`browser/notionSettings.ts`). Forcing a tab into the page shape would fill those
 * fields with invented values, so a tab carries what its own transport can actually witness instead: whether
 * the modal opened, how many rail entries matched the tab's names, and whether the client then marked it
 * selected.
 *
 * ## "Did not render" is a different fact from "does not exist"
 *
 * A route the client has no page for is `browser-page-unreachable`. A declared tab that did not render was
 * clicked for and not shown — the modal did not open, the rail no longer carries that name, or the client
 * marked something else selected. {@link settingsTabOutcome} grades each of those in its own words, and
 * `settingsGaps.ts` files them under their own condition, so neither vocabulary has to lie for the other.
 *
 * ## The selection is the witness, never the picture
 *
 * The tab arm photographs whatever the modal shows after the click, including when the click missed. A PNG
 * existing therefore proves only that a picture was taken; the picture is held only when the tab it is
 * filed under is among the entries the client marked selected. A picture byte-identical to another tab's
 * evidences neither — the failure the route walk shipped once, a run of identical not-found shells
 * reported as a filled surface.
 *
 * ## Every effect is a seam
 *
 * The transport, the scratch-PNG reader, the artifact writer and the clock are injected, so every branch here
 * is settled by a unit test over fakes rather than by a live run.
 */
import type { NotionSettingsObservation, NotionSettingsTransport } from "../../browser/notionSettings.js";
import { type BrowserTransportError, isWalkStoppingError } from "../../browser/pageTransport.js";
import type { Result } from "../../lib/result.js";
import { isUnrenderedScreenshot, UNRENDERED_SCREENSHOT_BECAUSE } from "../kit/browserWalk.js";
import type { AtlasArtifactRef } from "../kit/contract.js";

import { type NotionArtifactWriter, notionScreenshotArtifact } from "./browserWalk.js";
import { NOTION_SETTINGS_TABS, type NotionSettingsGroup, type NotionSettingsTab } from "./settingsTabs.js";

/**
 * The prefix every settings-tab surface name carries — and so every tab entity's provider id.
 *
 * It is what keeps the two browser publishers apart in the one `page` kind: the route walk never stales an
 * entity carrying it, and the tab publisher never touches one without it.
 */
const NOTION_SETTINGS_SURFACE_PREFIX = "settings/";

/**
 * The surface name one tab is reported under.
 *
 * @param id the tab's `--tab` spelling
 * @returns `settings/<id>`
 */
export function settingsTabSurface({ id }: { id: string }): string {
  return `${NOTION_SETTINGS_SURFACE_PREFIX}${id}`;
}

/**
 * Whether a `page`-kind entity is a settings tab rather than a declared route.
 *
 * @param providerId the entity's provider key
 * @returns whether it carries the settings prefix
 */
export function isSettingsTabProviderId({ providerId }: { providerId: string }): boolean {
  return providerId.startsWith(NOTION_SETTINGS_SURFACE_PREFIX);
}

/**
 * The coverage-cell scope the tabs are graded under — the second scope of the `browser-walk` surface, beside
 * the declared routes' own `declared-pages`. One surface, two denominators: a cell is replaced by the pair.
 */
export const NOTION_SETTINGS_COVERAGE_SCOPE = "declared-settings-tabs";

/**
 * Read one scratch screenshot the settings transport wrote, and remove it.
 *
 * Injected so the walk performs no I/O. It must remove the file whether or not the picture is kept: nothing
 * else deletes the scratch PNGs, so a reader that only read would leave one behind per declared tab on every run.
 */
export type NotionShotReader = (input: { path: string }) => Result<Uint8Array>;

/** What one declared settings tab's capture came to. */
export interface NotionSettingsTabObservation {
  /** `settings/<id>` — see {@link settingsTabSurface}. */
  readonly surface: string;
  readonly tabId: string;
  readonly group: NotionSettingsGroup;
  /** Every accessible name the tab was asked for under, from the declared list. */
  readonly names: readonly string[];
  /** Whether the walk asked for this tab at all. `false` after a lost session. */
  readonly attempted: boolean;
  /** When the capture finished, or `""` when the tab was never asked for. */
  readonly observedAt: string;
  /** Whether the settings modal's tab rail was showing when the modal was read back. */
  readonly dialogOpen: boolean;
  /** How many rail entries matched the tab's names — 1 is the only usable answer — or `null` when unknown. */
  readonly tabMatches: number | null;
  /** Whether the client marked this tab selected after the click. The witness a capture is graded on. */
  readonly selectionVerified: boolean;
  /** Why this tab was not shown, or `null` when the client showed it. Never quotes a URL. */
  readonly notRenderedBecause: string | null;
  /** Why this tab has no held screenshot, or `null` when it has one. */
  readonly screenshotMissingBecause: string | null;
  /** The proof screenshot, or an empty list when there is none — see {@link screenshotMissingBecause}. */
  readonly artifacts: readonly AtlasArtifactRef[];
}

/**
 * What the settings walk produced.
 *
 * @internal
 */
export interface NotionSettingsWalkResult {
  readonly tabs: readonly NotionSettingsTabObservation[];
  /** Whether the walk stopped early because the browser session was lost. */
  readonly sessionLost: boolean;
}

/**
 * Whether the client showed the tab that was asked for, graded on what it marked rather than on the picture.
 *
 * Every reason is written here rather than quoted from the transport: a Playwright error can carry the
 * address the page was on, and a Notion address carries the workspace slug. The one quoted string is the
 * snippet's own `refused`, which is a fixed sentence written in `browser/notionSettingsSnippet.ts`. The
 * client's `selectedTabs` are counted and never quoted, because the rail's first entry is the signed-in
 * person's own name.
 *
 * @param tab the declared tab that was asked for
 * @param observed what the tab arm reported
 * @returns why the tab was not shown, or `null` when it was
 */
export function settingsTabOutcome({
  tab,
  observed,
}: {
  tab: NotionSettingsTab;
  observed: NotionSettingsObservation;
}): string | null {
  if (observed.refused !== null) {
    return `nothing was clicked: ${observed.refused}`;
  }
  if (!observed.dialogOpen) {
    return "the settings modal did not open, so no tab could be selected";
  }
  const names = tab.names.join(" / ");
  if (observed.tabMatches === null || observed.tabMatches < 0) {
    return "the settings modal opened but no tab rail appeared in it";
  }
  if (observed.tabMatches === 0) {
    return `no tab in the settings rail goes by ${names} — Notion may have renamed it; re-measure the rail with \`slopweaver atlas notion settings\``;
  }
  if (observed.tabMatches > 1) {
    return `${String(observed.tabMatches)} tabs in the settings rail go by ${names}, so none was picked`;
  }
  if (observed.dialogError !== null) {
    return "the tab was found in the rail but the click on it did not complete";
  }
  if (!tab.names.some((name) => observed.selectedTabs.includes(name))) {
    return `the tab was clicked but the client did not mark it selected (it marked ${String(observed.selectedTabs.length)} other entry(s))`;
  }
  return null;
}

/**
 * Why a tab capture failed at the transport, in words that carry no URL.
 *
 * @param error the transport's typed failure
 * @returns the reason to record
 */
function transportReason({ error }: { error: BrowserTransportError }): string {
  if (error.code === "SESSION_LOST") {
    return "the browser session was lost — sign in to Notion in your own Chrome and run the walk again";
  }
  if (error.code === "TRANSPORT_UNAVAILABLE") {
    return "no browser transport was attached, so this tab was never asked for";
  }
  if (error.code === "NAVIGATION_FAILED") {
    return error.because;
  }
  return "the browser could not open the settings modal for this tab";
}

/** A row for a declared tab whose capture did not complete, whether it was asked for or not. */
function incompleteTab({
  tab,
  attempted,
  why,
  observedAt,
}: {
  tab: NotionSettingsTab;
  attempted: boolean;
  why: string;
  observedAt: string;
}): NotionSettingsTabObservation {
  return {
    artifacts: [],
    attempted,
    dialogOpen: false,
    group: tab.group,
    names: tab.names,
    notRenderedBecause: why,
    observedAt,
    screenshotMissingBecause: "the tab was never photographed, because its capture did not complete",
    selectionVerified: false,
    surface: settingsTabSurface({ id: tab.id }),
    tabId: tab.id,
    tabMatches: null,
  };
}

/**
 * Read, grade and store one tab's screenshot. The scratch file is read — and so removed — on every path
 * that has one, including when the picture is not kept.
 */
function heldShot({
  observed,
  rendered,
  readShot,
  writeArtifact,
}: {
  observed: NotionSettingsObservation;
  rendered: boolean;
  readShot: NotionShotReader;
  writeArtifact: NotionArtifactWriter;
}): { artifacts: readonly AtlasArtifactRef[]; missingBecause: string | null } {
  if (observed.screenshotPath === null) {
    return { artifacts: [], missingBecause: "the settings modal returned no screenshot for this tab" };
  }
  const read = readShot({ path: observed.screenshotPath });
  if (read.isErr()) {
    return { artifacts: [], missingBecause: `the screenshot could not be read back: ${read.error.join("; ")}` };
  }
  if (!rendered) {
    return {
      artifacts: [],
      missingBecause: "the picture is not held, because it shows something other than this tab",
    };
  }
  if (isUnrenderedScreenshot({ bytes: read.value })) {
    return { artifacts: [], missingBecause: UNRENDERED_SCREENSHOT_BECAUSE };
  }
  const ref = notionScreenshotArtifact({ bytes: read.value });
  const written = writeArtifact({ bytes: read.value, relativePath: ref.relativePath, sha256: ref.sha256 });
  if (written.isErr()) {
    return { artifacts: [], missingBecause: `the screenshot could not be stored: ${written.error.join("; ")}` };
  }
  return { artifacts: [ref], missingBecause: null };
}

/**
 * Capture one declared tab.
 *
 * @returns the observation, and whether the session was lost — a failed capture is a recorded row, but a
 *   lost session ends the walk
 */
function captureTab({
  tab,
  transport,
  readShot,
  writeArtifact,
  now,
}: {
  tab: NotionSettingsTab;
  transport: NotionSettingsTransport;
  readShot: NotionShotReader;
  writeArtifact: NotionArtifactWriter;
  now: () => string;
}): { observation: NotionSettingsTabObservation; sessionLost: boolean } {
  const read = transport.readTab({ tabNames: tab.names });
  if (read.isErr()) {
    return {
      observation: incompleteTab({
        attempted: true,
        observedAt: now(),
        tab,
        why: transportReason({ error: read.error }),
      }),
      sessionLost: isWalkStoppingError({ error: read.error }),
    };
  }
  const observed = read.value;
  const notRenderedBecause = settingsTabOutcome({ observed, tab });
  const shot = heldShot({ observed, readShot, rendered: notRenderedBecause === null, writeArtifact });
  return {
    observation: {
      artifacts: shot.artifacts,
      attempted: true,
      dialogOpen: observed.dialogOpen,
      group: tab.group,
      names: tab.names,
      notRenderedBecause,
      observedAt: now(),
      screenshotMissingBecause: shot.missingBecause,
      selectionVerified: notRenderedBecause === null,
      surface: settingsTabSurface({ id: tab.id }),
      tabId: tab.id,
      tabMatches: observed.tabMatches,
    },
    sessionLost: false,
  };
}

/**
 * Whether one tab is fully held — shown, photographed, and carrying the artifact to prove it.
 *
 * @param tab the observation to judge
 * @returns whether the atlas holds this declared tab in full
 */
export function isSettingsTabHeld({ tab }: { tab: NotionSettingsTabObservation }): boolean {
  return (
    tab.attempted &&
    tab.notRenderedBecause === null &&
    tab.screenshotMissingBecause === null &&
    tab.artifacts.length > 0
  );
}

/**
 * Mark every tab whose picture is byte-identical to another declared tab's as not independently evidenced.
 *
 * The declared tabs of one modal share a frame, but each panel renders its own heading and controls, so two
 * genuinely identical pictures mean the clicks did not change what was shown. Being wrong here costs a tab a
 * coverage credit rather than granting one — the rule `browserWalk.ts`'s `markIndistinguishablePages` holds
 * for routes, for the same measured reason.
 *
 * @param tabs every declared tab's observation
 * @returns the observations, with a shared picture recorded on each tab that shares one
 */
export function markIndistinguishableTabs({
  tabs,
}: {
  tabs: readonly NotionSettingsTabObservation[];
}): readonly NotionSettingsTabObservation[] {
  const bySha = new Map<string, string[]>();
  for (const tab of tabs) {
    for (const artifact of tab.artifacts) {
      const holders = bySha.get(artifact.sha256);
      if (holders === undefined) {
        bySha.set(artifact.sha256, [tab.tabId]);
      } else {
        holders.push(tab.tabId);
      }
    }
  }
  return tabs.map((tab): NotionSettingsTabObservation => {
    // Every digest was entered in the loop above, so each lookup is present by construction.
    const shared = tab.artifacts.flatMap((artifact) => bySha.get(artifact.sha256)!);
    const others = [...new Set(shared)].filter((id) => id !== tab.tabId).toSorted();
    if (others.length === 0) {
      return tab;
    }
    return {
      ...tab,
      artifacts: [],
      screenshotMissingBecause:
        `its screenshot is byte-identical to ${String(others.length)} other declared tab(s) ` +
        `(${others.join(", ")}), so it evidences no tab of its own`,
    };
  });
}

/**
 * Walk every declared settings tab.
 *
 * Strictly sequential: each capture re-opens the modal in the owner's own tab, and two at once would fight
 * over it. Each `readTab` navigates, opens the modal and selects one tab, so this costs one modal open per
 * declared tab, at two settles apiece (`NOTION_SETTLE_MS`).
 *
 * @param transport the settings transport, released by the caller rather than here
 * @param readShot reads and removes one scratch screenshot
 * @param writeArtifact where each held screenshot is written and verified
 * @param now the clock each capture is stamped with
 * @param progress where a line of progress goes; given the tab id, never a URL
 * @returns every declared tab's observation
 */
export function walkNotionSettingsTabs({
  transport,
  readShot,
  writeArtifact,
  now,
  progress,
}: {
  transport: NotionSettingsTransport;
  readShot: NotionShotReader;
  writeArtifact: NotionArtifactWriter;
  now: () => string;
  progress?: (input: { line: string }) => void;
}): NotionSettingsWalkResult {
  const tabs: NotionSettingsTabObservation[] = [];
  let sessionLost = false;
  for (const [index, tab] of NOTION_SETTINGS_TABS.entries()) {
    if (sessionLost) {
      tabs.push(
        incompleteTab({
          attempted: false,
          observedAt: "",
          tab,
          why: "the walk stopped before this tab: the browser session was lost part-way through",
        }),
      );
      continue;
    }
    progress?.({
      line: `notion settings: ${String(index + 1)}/${String(NOTION_SETTINGS_TABS.length)} ${tab.id}`,
    });
    const captured = captureTab({ now, readShot, tab, transport, writeArtifact });
    tabs.push(captured.observation);
    sessionLost = captured.sessionLost;
  }
  return { sessionLost, tabs: markIndistinguishableTabs({ tabs }) };
}

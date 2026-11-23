/**
 * What one settings walk could not answer, as gaps — pure, so the judgement is testable on its own.
 *
 * ## The route gaps are left exactly where they are
 *
 * The declared routes in `browserPages.ts` are MEASURED evidence that Notion's settings surface has no
 * address, and their `browser-page-*` gaps say so. Nothing here rechecks a route scope, and the kit's
 * lifecycle closes a gap only when its own `(condition, scope)` pair is rechecked, so a settings walk can
 * neither close those gaps nor restate them as tab failures. Every scope below is a `settings/` one.
 *
 * ## Every attempted tab contributes a recheck for every tab condition
 *
 * Same rule as `browserGaps.ts`: a tab that becomes renderable must offer the recheck that closes its old
 * gap, and a tab the walk never asked for rechecks nothing.
 */
import { type NotionGapCondition, type NotionGapRecheck, openNotionGap } from "./gaps.js";
import type { NotionAtlasGap } from "./model.js";
import { type NotionSettingsTabObservation, settingsTabSurface } from "./settingsWalk.js";

/** The scope the standing per-install gap is filed under. */
export const NOTION_SETTINGS_ACCOUNT_SCOPE = settingsTabSurface({ id: "account-self" });

/** Every condition one declared tab can raise, so a run can recheck each of them by name. */
const TAB_CONDITIONS: readonly NotionGapCondition[] = [
  "settings-tab-not-rendered",
  "settings-tab-not-attempted",
  "settings-tab-screenshot-missing",
];

/** The one condition a tab's own state raises, or `null` when the tab is fully held. */
function tabCondition({ tab }: { tab: NotionSettingsTabObservation }): NotionGapCondition | null {
  if (!tab.attempted) {
    return "settings-tab-not-attempted";
  }
  if (tab.notRenderedBecause !== null) {
    return "settings-tab-not-rendered";
  }
  if (tab.screenshotMissingBecause !== null || tab.artifacts.length === 0) {
    return "settings-tab-screenshot-missing";
  }
  return null;
}

/** The reason line a tab's gap carries. */
function tabReason({ tab, condition }: { tab: NotionSettingsTabObservation; condition: NotionGapCondition }): string {
  if (condition === "settings-tab-screenshot-missing") {
    // A shown tab carrying no artifact and no recorded reason is still unheld — `tabCondition` says so.
    if (tab.screenshotMissingBecause === null) {
      return "the tab has no proof screenshot";
    }
    return tab.screenshotMissingBecause;
  }
  // Every other condition is raised only by a tab that carries its own not-rendered reason.
  return tab.notRenderedBecause!;
}

/**
 * One gap per declared tab this walk did not fully hold.
 *
 * @param tabs every declared tab's observation
 * @param at this run's ISO timestamp
 * @returns the gaps, in declaration order
 */
export function settingsTabGaps({
  tabs,
  at,
}: {
  tabs: readonly NotionSettingsTabObservation[];
  at: string;
}): readonly NotionAtlasGap[] {
  return tabs.flatMap((tab): readonly NotionAtlasGap[] => {
    const condition = tabCondition({ tab });
    if (condition === null) {
      return [];
    }
    return [
      openNotionGap({
        at,
        condition,
        fields: [],
        kind: "page",
        reason: tabReason({ condition, tab }),
        scope: tab.surface,
        surfaces: ["browser"],
      }),
    ];
  });
}

/**
 * The standing gap for the one settings tab this atlas cannot declare.
 *
 * MEASURED by `slopweaver atlas notion settings`: the rail carries seventeen entries, and the
 * first Account entry is labelled with the SIGNED-IN PERSON'S OWN NAME. Declaring it in `settingsTabs.ts`
 * would write one install's account into shipped source, so the atlas says it is missing instead — always
 * open, because no run can close it.
 *
 * @param at this run's ISO timestamp
 * @returns the standing gap
 */
export function accountTabGap({ at }: { at: string }): NotionAtlasGap {
  return openNotionGap({
    at,
    condition: "settings-tab-undeclared-per-install",
    fields: [],
    kind: "page",
    reason:
      "the settings rail's first Account tab is labelled with the signed-in person's own name, so it is " +
      "per-install state and is not in the declared tab list — its panel (the account's own profile) is not " +
      "photographed by this walk",
    scope: NOTION_SETTINGS_ACCOUNT_SCOPE,
    surfaces: ["browser"],
  });
}

/**
 * Every `(condition, scope)` pair this walk genuinely rechecked, and what the recheck found.
 *
 * @param tabs every declared tab's observation
 * @returns the rechecks, one per condition per attempted tab
 */
export function settingsTabRechecks({
  tabs,
}: {
  tabs: readonly NotionSettingsTabObservation[];
}): readonly NotionGapRecheck[] {
  return tabs
    .filter((tab) => tab.attempted)
    .flatMap((tab) => {
      const raised = tabCondition({ tab });
      return TAB_CONDITIONS.map((condition) => ({ condition, resolved: condition !== raised, scope: tab.surface }));
    });
}

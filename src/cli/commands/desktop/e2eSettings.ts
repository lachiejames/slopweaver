/**
 * The Settings step's act, against a real bundle: press the sidebar's Settings button the way the owner does and, for a step
 * that names a tab, press that tab. `e2eDriver.ts` runs it for every `settings` step.
 */
import type { Page } from "playwright-core";

import { type E2eStep, SETTINGS_BUTTON, SETTINGS_NAV, settingsTab } from "../../../desktop/e2ePlan.js";
import { SETTLE_CAP_MS } from "./e2ePage.js";

/** How long a pressed Settings button gets to show its dialog before it is pressed again. */
const SETTINGS_OPEN_CAP_MS = 3000;

/**
 * Open Settings from its sidebar button, pressing it once more when no dialog came: a press that lands before the Queue
 * has hydrated opens nothing. Measured on a walk whose first step was Settings; repro:
 * `slopweaver desktop e2e --checkout <worktree> --only settings-presence` against a cold dev console.
 *
 * @param page the console page the sidebar is on
 */
async function openSettings({ page }: { page: Page }): Promise<void> {
  const button = page.locator(SETTINGS_BUTTON).first();
  const nav = page.locator(SETTINGS_NAV).first();
  await button.click();
  const opened = await nav.waitFor({ timeout: SETTINGS_OPEN_CAP_MS }).then(
    () => true,
    () => false,
  );
  if (!opened) {
    await button.click();
    await nav.waitFor({ timeout: SETTLE_CAP_MS }).catch(() => undefined);
  }
}

/** The walk's Settings step. */
type SettingsStep = Extract<E2eStep, { kind: "settings" }>;

/**
 * The tab a Settings step presses once the dialog is open: none for the opening tab, which the dialog lands on itself.
 *
 * @param step the walk's Settings step, carrying the tab to land on
 * @returns the tab's selector, or `undefined` when no second press is due
 */
export function settingsTabToPress({ step }: { step: SettingsStep }): string | undefined {
  if (step.tab === "opening") {
    return undefined;
  }
  return settingsTab({ tab: step.tab });
}

/**
 * Open Settings on the tab a step names.
 *
 * @param page the console page the sidebar is on
 * @param step the walk's Settings step, carrying the tab to land on
 */
export async function openSettingsAt({ page, step }: { page: Page; step: SettingsStep }): Promise<void> {
  await openSettings({ page });
  const tab = settingsTabToPress({ step });
  if (tab !== undefined) {
    await page.locator(tab).first().click();
  }
}

/**
 * `desktop e2e`'s check of the bundle before anything is launched: there, from after the test switch, and — when the
 * run asked for the test instance's own menu bar icon — able to draw it. The protocols are read off its `Info.plist`
 * by `src/desktop/e2ePlan.ts`; this is the read.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { type DesktopE2eError, DesktopE2eErrors } from "../../../desktop/e2eErrors.js";
import { speaksE2e, speaksE2eMenuBar } from "../../../desktop/e2ePlan.js";

/**
 * Refuse a bundle that is not there, one from before the test switch, or — with `menuBar` — one that cannot draw the
 * Slopweaver Test icon, before anything is launched.
 *
 * @param app the bundle
 * @param menuBar whether the run asked for the Slopweaver Test menu bar icon
 * @returns nothing, or why it will not be launched
 */
export function checkE2eBundle({ app, menuBar }: { app: string; menuBar: boolean }): Result<void, DesktopE2eError> {
  const plistPath = join(app, "Contents", "Info.plist");
  if (!existsSync(plistPath)) {
    return err(DesktopE2eErrors.bundleMissing({ path: app }));
  }
  const plist = readFileSync(plistPath, "utf8");
  if (!speaksE2e({ plist })) {
    return err(DesktopE2eErrors.unsupportedBuild({ path: app }));
  }
  if (menuBar && !speaksE2eMenuBar({ plist })) {
    return err(DesktopE2eErrors.unsupportedMenuBarBuild({ path: app }));
  }
  return ok(undefined);
}

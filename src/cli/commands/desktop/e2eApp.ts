/**
 * The one launcher `slopweaver desktop e2e` has, for the walk and the call leg alike: a real bundle started as a
 * TEST INSTANCE through `playwright-core`'s own Electron launcher, and ended. Playwright owns the child it spawned and
 * the debugging channel it opened, so nothing here names a port, a profile or a browser
 * (`src/devLint/noPrivateBrowserProfile.ts`), and the child is the one process it ends.
 *
 * **The call leg's microphone is a file.** Only when the leg asks does the launch add Chromium's fake-media switches,
 * so the instance hears a generated WAV instead of the owner's microphone, with the audio service unsandboxed so it can read
 * that file. The windows stay visible and interruptible. No `--headless`, no autoplay switch.
 */
import { join } from "node:path";

import { _electron, type ElectronApplication } from "playwright-core";

import { err, ok, type Result } from "#lib/result.js";
import { type DesktopE2eError, DesktopE2eErrors } from "../../../desktop/e2eErrors.js";
import { E2E_MENU_BAR_SWITCH_ARG, E2E_SWITCH_ARG } from "../../../desktop/e2ePlan.js";

/** How long the launcher waits for the bundle to answer Playwright. */
const LAUNCH_CAP_MS = 60_000;

/**
 * The arguments a test instance is launched with: the switch and the checkout, its own Slopweaver Test menu bar icon
 * when asked, and the fake microphone when one is given.
 *
 * @param checkout the checkout whose console the instance reads
 * @param userData the instance's own saved state and lock
 * @param menuBar whether the instance draws its own menu bar icon, named Slopweaver Test
 * @param fakeAudioPath the WAV the instance hears as its microphone, `undefined` for none
 * @returns the arguments, in order
 */
export function e2eLaunchArgs({
  checkout,
  userData,
  menuBar,
  fakeAudioPath,
}: {
  checkout: string;
  userData: string;
  menuBar: boolean;
  fakeAudioPath: string | undefined;
}): readonly string[] {
  const switches = [`${E2E_SWITCH_ARG}=${userData}`, ...(menuBar ? [E2E_MENU_BAR_SWITCH_ARG] : [])];
  const base = [...switches, `--checkout=${checkout}`];
  if (fakeAudioPath === undefined) {
    return base;
  }
  return [
    ...base,
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${fakeAudioPath}`,
    // The sandboxed audio service cannot open the WAV and hears silence instead (peak 0.0 with it, 0.95 without,
    // measured on a candidate build by an AnalyserNode over the fake input, reproduce by sampling
    // `getUserMedia` on a test instance launched with and without this switch). A test instance only.
    "--disable-features=AudioServiceSandbox",
  ];
}

/**
 * Launch a bundle as a test instance.
 *
 * @param app the bundle, `…/Slopweaver.app`
 * @param checkout the checkout whose console it reads
 * @param userData its own saved state and lock
 * @param menuBar whether it draws its own Slopweaver Test menu bar icon
 * @param fakeAudioPath the WAV it hears as its microphone, `undefined` for the walk, which never places a call
 * @returns the running instance, or why it could not be launched
 */
export async function launchE2eApp({
  app,
  checkout,
  userData,
  menuBar,
  fakeAudioPath,
}: {
  app: string;
  checkout: string;
  userData: string;
  menuBar: boolean;
  fakeAudioPath: string | undefined;
}): Promise<Result<ElectronApplication, DesktopE2eError>> {
  return _electron
    .launch({
      args: [...e2eLaunchArgs({ checkout, fakeAudioPath, menuBar, userData })],
      executablePath: join(app, "Contents", "MacOS", "Slopweaver"),
      timeout: LAUNCH_CAP_MS,
    })
    .then((launched) => ok(launched))
    .catch((cause: unknown) =>
      err(DesktopE2eErrors.launchFailed({ detail: cause instanceof Error ? cause.message : String(cause), path: app })),
    );
}

/**
 * End a test instance: close it, and kill its process if closing throws.
 *
 * @param app the instance
 */
export async function closeE2eApp({ app }: { app: ElectronApplication }): Promise<void> {
  await app.close().catch(() => app.process().kill());
}

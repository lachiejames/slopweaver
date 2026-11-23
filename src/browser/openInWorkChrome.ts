/**
 * Open one page in the owner's work Chrome profile, on their screen, and return at once — the effectful edge a monitor card's
 * sign-in goes through (`../monitor/pass.ts`'s `PageOpener`), so the window is up before the note says to sign in
 * there. Signing in itself, in the already opened browser, is the only thing the owner has to do: the
 * `resync-signed-out` card must never hand over a pin command to paste into a terminal.
 *
 * Through the pin (`./profilePin.ts`), refreshed from the recorded profile, because a page opened any other way lands
 * in whichever profile Chrome last used — possibly the owner's personal one. `open -a` is out for the reason that file gives:
 * it drops `--args` for a Chrome already running, and the profile with them.
 *
 * Launched SYNCHRONOUSLY, through a shell that backgrounds the pin and exits, because `no-headless` bans every
 * asynchronous child-process capability (AGENTS.md rule 2) and a plain synchronous run of the pin would block the
 * pass for as long as Chrome lives whenever Chrome was not already running — the launched process IS Chrome then.
 * What is backgrounded is a visible browser window, never a model.
 *
 * It lands on TOP of Chrome's own windows, and that is the point: every Playwright launch stays behind the owner's windows by
 * default (`./foreground.ts`), but this page is one the OWNER has to use, so it never goes through either
 * relay lane and nothing puts their previous window back over it. It does not activate Chrome over the app they are in —
 * MEASURED with cmux in front, the page's window opened top of Chrome's stack and cmux stayed front — so
 * the card's note is what sends the owner there, and switching to Chrome lands them on the page.
 */
import { spawnSync } from "node:child_process";

import { errorMessage } from "../lib/errorMessage.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";

import { resolveChromePin } from "./profilePin.js";
import type { RecordedProfilePort } from "./recordedProfile.js";

/** How long the backgrounding shell may take; it forks the pin and exits, so anything near this is a hang. */
const LAUNCH_TIMEOUT_MS = 10_000;

/**
 * The program and argv that start the pin on one page in the background and return. The pin and the page travel as
 * positional parameters, never spliced into the script, so neither is ever parsed as shell.
 *
 * @param pin the pin script's path
 * @param url the page to open
 * @returns the program to run and its arguments
 */
export function pinLaunchCommand({ pin, url }: { pin: string; url: string }): {
  program: string;
  args: readonly string[];
} {
  return { args: ["-c", 'nohup "$0" "$1" >/dev/null 2>&1 &', pin, url], program: "/bin/sh" };
}

/**
 * Launch the pin on one page and let it go.
 *
 * @param home the state home whose recorded profile and pin to use
 * @param url the page to open
 * @param profiles the door the recorded work profile is read through
 * @returns what opened, or why nothing could
 */
export async function openInWorkChrome({
  home,
  profiles,
  url,
}: {
  home: string;
  profiles: RecordedProfilePort;
  url: string;
}): Promise<Result<string, string>> {
  const paths = stateHomePaths({ home });
  const pin = await resolveChromePin({ home, path: paths.chromePin, profiles });
  if (pin.isErr()) {
    return err(`no work Chrome pin to open it through: ${pin.error.message}`);
  }
  const { program, args } = pinLaunchCommand({ pin: pin.value, url });
  let launched: ReturnType<typeof spawnSync>;
  try {
    launched = spawnSync(program, [...args], { stdio: "ignore", timeout: LAUNCH_TIMEOUT_MS });
  } catch (error) {
    // `spawnSync` THROWS rather than returning an error for an argument it cannot pass at all — a NUL in the page.
    return err(`could not launch the work Chrome pin: ${errorMessage({ error })}`);
  }
  if (launched.error !== undefined) {
    return err(`could not launch the work Chrome pin: ${launched.error.message}`);
  }
  if (launched.status !== 0) {
    return err(`the work Chrome pin's launcher exited ${String(launched.status)}`);
  }
  return ok(`opened ${url} in the owner's work Chrome`);
}

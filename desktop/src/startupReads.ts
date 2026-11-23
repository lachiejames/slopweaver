/**
 * What the shell reads as it starts: which checkout serves the console, a bundle's `Info.plist`, read for its build
 * stamp, and where its saved state lives. Split from `main.ts`, which sits at its 300-line cap.
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { app } from "electron";
import { err, type Result } from "neverthrow";

import { checkoutArgument } from "./consoleEndpoint";
import { validateCheckout } from "./consoleServer";
import { type CheckoutError, CheckoutErrors } from "./errors";

/**
 * The checkout to serve from: `--checkout`, else the saved one, else — running from source — the checkout this
 * shell lives in. Never a guessed home-directory path.
 *
 * @param argv the process's arguments
 * @param savedCheckout the checkout the saved state names, `null` before one was validated
 * @returns the validated checkout, or why there is none
 */
export function chooseCheckout({
  argv,
  savedCheckout,
}: {
  argv: readonly string[];
  savedCheckout: string | null;
}): Result<string, CheckoutError> {
  const named = checkoutArgument({ argv });
  if (named !== undefined) {
    return validateCheckout({ path: resolve(named) });
  }
  if (savedCheckout !== null) {
    return validateCheckout({ path: savedCheckout });
  }
  if (!app.isPackaged) {
    return validateCheckout({ path: resolve(app.getAppPath(), "..") });
  }
  return err(CheckoutErrors.unset());
}

/**
 * A small text file, or `undefined` when it cannot be read — a bundle from before stamps reads the same way, as
 * "no stamp", which is what the sidebar says of both.
 *
 * @returns the text
 */
export async function readPlist({ path }: { path: string }): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * The state file, in Electron's own per-app directory.
 *
 * @returns the absolute path of `state.json` under the app's `userData`
 */
export function statePath(): string {
  return join(app.getPath("userData"), "state.json");
}

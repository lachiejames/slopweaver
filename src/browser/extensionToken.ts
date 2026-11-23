/**
 * The Playwright Extension consent token the OWNER provisioned, and nothing else.
 *
 * It lives beside `playwrightCli.ts` rather than in any one atlas's command file because every browser leg
 * needs it and none of them owns it: the CrowdStrike walk read it first, the Vanta walk needs the same
 * value, and a second reader would have been a second place to get the 0600 check wrong.
 *
 * The token is what lets a walk run without a dialog in the owner's browser asking whether to expose every
 * signed-in session. It is read from the secrets store because that is where the owner wrote it, by hand
 * — never from the dialog itself, which would be this program granting itself the access the
 * dialog exists to ask about. The value is returned and never printed; a refusal names the FILE.
 */
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";

import { errorMessage } from "../lib/errorMessage.js";
import { err, ok, type Result } from "../lib/result.js";
import { secretFilePath } from "../stateHome.js";
import { type BrowserError, BrowserErrors, browserErrorLines } from "./browserErrors.js";

/**
 * Read the Playwright Extension consent token the OWNER provisioned.
 *
 * The token is what lets a walk run without a dialog in the owner's browser asking whether to expose every
 * signed-in session. It is read from the secrets store because that is where the owner wrote it, by hand
 * — never from the dialog itself, which would be this program granting itself the access the
 * dialog exists to ask about. The value is returned and never printed; a refusal names the FILE.
 *
 * @param home the state home whose `secrets/` directory holds it
 * @returns the token, or why it could not be read
 */
export function readExtensionToken({ home }: { home: string }): Result<string, BrowserError> {
  const path = secretFilePath({ home, name: "playwright-extension-token" });
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = fstatSync(descriptor);
    if ((stats.mode & 0o077) !== 0) {
      return err(BrowserErrors.extensionTokenNotOwnerOnly({ path }));
    }
    const value = readFileSync(descriptor, "utf8").trim();
    return value.length === 0 ? err(BrowserErrors.extensionTokenEmpty({ path })) : ok(value);
  } catch (error: unknown) {
    return err(BrowserErrors.extensionTokenUnreadable({ detail: errorMessage({ error }), path }));
  } finally {
    if (descriptor !== null) {
      closeSync(descriptor);
    }
  }
}

/**
 * The same read, for a caller whose contract prints one line per problem.
 *
 * @param home the state home whose `secrets/` directory holds it
 * @returns the token, or each line of why it could not be read
 */
export function readExtensionTokenLines({ home }: { home: string }): Result<string> {
  return readExtensionToken({ home }).mapErr((error) => browserErrorLines({ error }));
}

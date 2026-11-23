/**
 * The two things every atlas walk needs before it can drive the owner's Chrome, resolved once.
 *
 * A walk verb cannot start without the Playwright extension's consent token and the Chrome profile pin,
 * and both are read the same way with the same two failure messages by every walking atlas. Three of them
 * had written the identical fifteen lines before this existed.
 *
 * ## Why the pin is not optional, and not this module's opinion
 *
 * `docs/browser-route/brief-profile-and-walks.md` carries the measurement: the relay chooses no profile at all, so Chrome places
 * the connect page in whichever profile it was last used in — which put a connect page in the owner's
 * PERSONAL profile while they were reading something there. The pin is what makes the walk land in the work
 * profile, so resolving it is part of attaching rather than a detail a verb may skip.
 *
 * What a platform still owns is everything after this: which routes it visits, how it grades an outcome,
 * and what its denominator is.
 */
import { readExtensionTokenLines } from "../../browser/extensionToken.js";
import { resolveChromePin } from "../../browser/profilePin.js";
import type { RecordedProfilePort } from "../../browser/recordedProfile.js";
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";

/**
 * What a walk needs in hand before it constructs a transport.
 * @internal
 */
export interface ChromeAttachment {
  /** The shim Chrome is launched through, so the connect page opens in the recorded work profile. */
  readonly chromePinPath: string;
  /** The Playwright extension consent token the owner provisioned. */
  readonly extensionToken: string;
}

/**
 * Resolve the extension token and the Chrome profile pin for one walk.
 *
 * @param home the resolved `$SLOPWEAVER_HOME` both are read from
 * @param resolvePin how the pin is resolved — `resolveChromePin` in production; a test passes a plain function,
 *   because the real one asks Playwright where Chrome is installed and a test machine may have none
 * @param profiles the door the recorded work profile is read through, built at the verb's composition root
 * @returns what a transport needs, or every reason the walk cannot attach
 */
export async function resolveChromeAttachment({
  home,
  profiles,
  resolvePin = resolveChromePin,
}: {
  home: string;
  profiles: RecordedProfilePort;
  resolvePin?: typeof resolveChromePin;
}): Promise<Result<ChromeAttachment>> {
  const token = readExtensionTokenLines({ home });
  if (token.isErr()) {
    return err(token.error);
  }
  const paths = stateHomePaths({ home });
  const pin = await resolvePin({ home, path: paths.chromePin, profiles });
  if (pin.isErr()) {
    return err([pin.error.message]);
  }
  return ok({ chromePinPath: pin.value, extensionToken: token.value });
}

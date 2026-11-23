/**
 * Attaching a browser walk to the owner's own Chrome, once rather than once per atlas.
 *
 * Nothing here launches a browser. `playwright-core`'s extension relay attaches to the Chrome the owner is already
 * running (`docs/browser-route/target-proof-and-playwright.md`), and `docs/browser-route.md` carries the
 * ruling. The profile pin is resolved BEFORE anything launches, because without it Chrome opens the connect
 * page in whichever profile it was last used in, which is what `src/browser/profilePin.ts` exists to prevent.
 * A missing recorded profile therefore stops a walk rather than sending it to the owner's personal browsing.
 *
 * The scratch directory lives under the calling atlas's own generation directory, which `stateHome.ts`
 * resolved — never a path an atlas builds from `home` itself.
 *
 * The transport this returns holds the machine's one relay lease, so it is EXCLUSIVE and ORIGIN-BOUND for
 * as long as it lives: `browser/relayLease.ts` carries the measurement of four walks driving one
 * tab at once. `platform` and `origins` are required here for the same reason they are required on the
 * transport's own deps — there is no shape of an atlas walk that may decline to say whose it is or where it
 * is allowed to go.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { browserErrorLines } from "../../browser/browserErrors.js";
import { readExtensionToken } from "../../browser/extensionToken.js";
import type { BrowserPageTransport } from "../../browser/pageTransport.js";
import { createPlaywrightCliTransport } from "../../browser/playwrightCli.js";
import { resolveChromePin } from "../../browser/profilePin.js";
import type { RecordedProfilePort } from "../../browser/recordedProfile.js";
import { realRelayLeaseWait } from "../../browser/relayLease.js";
import type { PlaywrightCliDeps } from "../../browser/relaySession.js";
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";

/**
 * Build the transport one walk drives.
 *
 * @param home the state home the consent token, the recorded profile and the relay lease live under
 * @param directory the atlas's own generation directory, which the scratch directory is made under
 * @param platform the atlas asking, so a lease refusal on the other side can name who is holding the relay
 * @param origins every origin this walk may address — its whole world for the length of the lease
 * @param profiles the door the recorded work profile is read through, built at the verb's composition root
 * @returns a transport attached to the owner's own Chrome, or every reason there is none
 */
export async function attachWalkTransport({
  home,
  directory,
  platform,
  origins,
  profiles,
}: {
  home: string;
  directory: string;
  platform: string;
  origins: readonly string[];
  profiles: RecordedProfilePort;
}): Promise<Result<BrowserPageTransport>> {
  return attachTransportAt({ home, origins, platform, profiles, scratchDir: join(directory, "_walk") });
}

/**
 * The same attach as {@link attachWalkTransport}, for a caller that names the directory its PNGs go in — the
 * Vanta verbs, whose verified writer stores the digest-addressed copy beside the raw capture.
 *
 * @param home the state home the consent token, the recorded profile and the relay lease live under
 * @param scratchDir where the transport writes its PNG artifacts
 * @param platform the atlas asking, so a lease refusal on the other side can name who is holding the relay
 * @param origins every origin this walk may address — its whole world for the length of the lease
 * @param profiles the door the recorded work profile is read through, built at the verb's composition root
 * @returns a transport attached to the owner's own Chrome, or every reason there is none
 */
export async function attachTransportAt({
  home,
  scratchDir,
  platform,
  origins,
  profiles,
}: {
  home: string;
  scratchDir: string;
  platform: string;
  origins: readonly string[];
  profiles: RecordedProfilePort;
}): Promise<Result<BrowserPageTransport>> {
  const deps = await relayDepsAt({ home, origins, platform, profiles, scratchDir });
  if (deps.isErr()) {
    return err(deps.error);
  }
  return ok(createPlaywrightCliTransport({ deps: deps.value }));
}

/**
 * Resolve everything a relay transport needs — the consent token, the profile pin, a scratch directory
 * under the caller's own, and the lease's home, platform and origins — exactly once in the tree.
 *
 * Split out of {@link attachWalkTransport} so `browser shot`'s evidence capture builds
 * its own transport (`browser/evidenceCapture.ts`) from the same resolution rather than a second copy.
 *
 * @param home the state home the token, the pin and the relay lease live under
 * @param directory the caller's own directory; the transport's scratch is `_walk` beneath it
 * @param platform the lane the lease is taken for, so a refusal elsewhere can name the holder
 * @param origins every origin the lease permits
 * @param profiles the door the recorded work profile is read through
 * @returns the dependencies, or why the owner's browser cannot be reached
 */
export async function relayDepsFor({
  home,
  directory,
  platform,
  origins,
  profiles,
}: {
  home: string;
  directory: string;
  platform: string;
  origins: readonly string[];
  profiles: RecordedProfilePort;
}): Promise<Result<PlaywrightCliDeps>> {
  return relayDepsAt({ home, origins, platform, profiles, scratchDir: join(directory, "_walk") });
}

/**
 * The same resolution as {@link relayDepsFor}, for a caller that names the directory its PNGs go in — the
 * one place a relay transport's token, profile pin, lease identity and lease wait are put together.
 *
 * @param home the state home the token, the pin and the relay lease live under
 * @param scratchDir where the transport writes its PNG artifacts; made here once the token is read
 * @param platform the lane the lease is taken for, so a refusal elsewhere can name the holder
 * @param origins every origin the lease permits
 * @param profiles the door the recorded work profile is read through
 * @returns the dependencies, or why the owner's browser cannot be reached
 */
export async function relayDepsAt({
  home,
  scratchDir,
  platform,
  origins,
  profiles,
}: {
  home: string;
  scratchDir: string;
  platform: string;
  origins: readonly string[];
  profiles: RecordedProfilePort;
}): Promise<Result<PlaywrightCliDeps>> {
  const token = readExtensionToken({ home });
  if (token.isErr()) {
    return err(browserErrorLines({ error: token.error }));
  }
  mkdirSync(scratchDir, { recursive: true });
  const statePaths = stateHomePaths({ home });
  const pin = await resolveChromePin({ home, path: statePaths.chromePin, profiles });
  if (pin.isErr()) {
    return err([pin.error.message]);
  }
  return ok({
    chromePinPath: pin.value,
    extensionToken: token.value,
    home,
    leaseWait: realRelayLeaseWait(),
    nowIso: () => new Date().toISOString(),
    origins,
    platform,
    scratchDir,
  });
}

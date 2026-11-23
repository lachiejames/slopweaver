/**
 * The effectful edge of `./adc.ts`: one real token read through Google's own SDK, and one stat of the file a
 * sign-in rewrites.
 *
 * A NEW `GoogleAuth` on every probe, deliberately: the SDK caches the credential it first resolves
 * (`googleauth.js`'s `cachedCredential`), so a reused instance keeps refreshing with the refused token forever
 * and a waiting seat would never see the owner's sign-in land. An `authorized_user` credential carries no access token,
 * so every probe is an honest refresh against Google rather than a cached answer.
 *
 * The token itself is never returned, printed or stored: it goes out of scope inside {@link probeAdc}.
 */
import { statSync } from "node:fs";

import { GoogleAuth } from "googleapis-common";

import { type AdcReading, type AdcSource, classifyAdcFailure } from "./adc.js";

/** The scope every Google Cloud client library asks for under ADC. */
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/**
 * Read whether the credential the SDK resolves works right now.
 *
 * The SDK resolves the credential from `process.env` itself; `source` is what this process computed from that
 * same environment, carried into the reading so every line names the file it judged.
 *
 * @param source the file the SDK's chain resolves to
 * @returns the reading — valid, or why not
 */
export async function probeAdc({ source }: { source: AdcSource }): Promise<AdcReading> {
  try {
    const token = await new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] }).getAccessToken();
    if (typeof token === "string" && token.length > 0) {
      return { detail: "Google accepted the credential", source, state: "valid" };
    }
    return { detail: "the SDK returned no access token", source, state: "failed" };
  } catch (error: unknown) {
    return { ...classifyAdcFailure({ error }), source };
  }
}

/**
 * The credential file's fingerprint: what a sign-in changes.
 *
 * @param path the credential file
 * @returns `mtimeMs:size`, or `missing` when there is no file
 */
export function adcFingerprint({ path }: { path: string }): string {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (stat === undefined) {
    return "missing";
  }
  return `${String(stat.mtimeMs)}:${String(stat.size)}`;
}

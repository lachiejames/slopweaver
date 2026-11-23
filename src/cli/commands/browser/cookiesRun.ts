/**
 * `slopweaver browser cookies` — is the owner's recorded Chrome profile signed in to this origin, and until when.
 *
 * **A cookie value never leaves `src/browser/cookieJar.ts`.** This reports how many cookies apply to an origin,
 * their NAMES, and the earliest expiry among them. That is enough to answer "am I signed in to this in my own
 * browser", which is the only question this sub-verb exists for.
 */
import { readOriginCookies } from "../../../browser/cookieJar.js";
import type { JarCookie } from "../../../browser/cookieScope.js";
import { type RecordedProfilePort, readRecordedProfile } from "../../../browser/recordedProfile.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import type { BrowserOptions } from "./profileCore.js";

/**
 * Run `browser cookies`: is that profile signed in to this origin, and until when.
 *
 * @param profiles the door the recorded work profile is read through
 * @returns EXIT_OK when any cookie applies to the origin, else EXIT_ERROR
 */
export async function runCookies({
  options,
  home,
  profiles,
}: {
  options: BrowserOptions;
  home: string;
  profiles: RecordedProfilePort;
}): Promise<number> {
  const directory = await readRecordedProfile({ home, profiles });
  if (directory.isErr()) {
    logger.error({ msg: directory.error.message });
    return EXIT_ERROR;
  }
  // `!` rather than a default: `parseBrowserArgs` refuses `cookies` with no `--origin`, so an absent one
  // here is a parser bug, and coalescing would turn it into a silent read of no origin at all.
  const origin = options.origin!;
  const cookies = await readOriginCookies({ directory: directory.value, origin, platform: process.platform });
  if (cookies.isErr()) {
    logger.error({ msg: cookies.error.message });
    return EXIT_ERROR;
  }
  reportCookies({ cookies: cookies.value, directory: directory.value, json: options.json, origin });
  return cookies.value.length > 0 ? EXIT_OK : EXIT_ERROR;
}

/**
 * Report what applies to an origin — names and lifetimes, never a value.
 *
 * @param cookies the rows that apply
 * @param origin the origin that was asked about
 * @param directory the profile they were read from
 * @param json whether machine-readable output was asked for
 */
function reportCookies({
  cookies,
  origin,
  directory,
  json,
}: {
  cookies: readonly JarCookie[];
  origin: string;
  directory: string;
  json: boolean;
}): void {
  const hard = cookies.map((cookie) => cookie.expires).filter((expires: number) => expires > 0);
  const earliest = hard.length > 0 ? Math.min(...hard) : null;
  if (json) {
    logger.out({
      line: JSON.stringify(
        {
          count: cookies.length,
          earliestExpiryEpochSeconds: earliest,
          names: cookies.map((cookie) => cookie.name).toSorted(),
          origin,
          profileDirectory: directory,
        },
        null,
        2,
      ),
    });
    return;
  }
  if (cookies.length === 0) {
    logger.out({ line: `your Chrome profile ${directory} holds no cookies for ${origin} — sign in to it there` });
    return;
  }
  logger.out({ line: `your Chrome profile ${directory} holds ${String(cookies.length)} cookie(s) for ${origin}` });
  logger.out({
    line: `  ${cookies
      .map((cookie) => cookie.name)
      .toSorted()
      .join(", ")}`,
  });
  logger.out({
    line:
      earliest === null
        ? "  none of them carries a hard expiry, so the site ends the session on its own schedule"
        : `  the earliest hard expiry is epoch second ${String(earliest)}`,
  });
}

/**
 * Read what each door row needs to be reachable at all — a stored Google or Outlook grant, or a recorded Chrome
 * profile (the store's row, read through its port), so `src/route/`'s pure planners can be handed data.
 *
 * The split mirrors `./atlasReadings.ts` beside `./atlasReading.ts`: the rule lives in
 * `./connectionReading.ts` and touches no disk, while this module performs the reads. No provider is called — a
 * grant is one owner-only file under `$SLOPWEAVER_HOME/secrets`, so grading a grant door costs one `readFileSync`
 * and no token material is read back out of it; the browser door alone asks the local store, once.
 *
 * Only the doors a row actually names are read, so a table carrying none of them opens nothing.
 */

import type { RecordedProfilePort } from "../browser/recordedProfile.js";
import type { Result } from "../lib/result.js";
import { calendarGrantStore } from "../secrets/calendarGrant.js";
import { driveGrantStore } from "../secrets/driveGrant.js";
import { gmailGrantStore } from "../secrets/gmailGrant.js";
import { outlookMailGrantStore } from "../secrets/outlookGrant.js";

import { type ConnectionRouteReading, connectionDoorOf } from "./connectionReading.js";
import type { SourceCapability } from "./profile.js";

/** Read one door's stored grant: `undefined` when none is stored, an error when a stored one will not parse. */
type GrantRead = (args: { home: string }) => Result<{ readonly account: string } | undefined>;

/** The grant read behind each door this module can read — the three Google stores and the Outlook mail one. */
const GRANT_READ_BY_DOOR: Readonly<Record<string, GrantRead>> = {
  calendar: calendarGrantStore.read,
  drive: driveGrantStore.read,
  gmail: gmailGrantStore.read,
  outlook: outlookMailGrantStore.read,
};

/**
 * Grade one door from its stored grant.
 *
 * A missing grant file and a grant that will not parse are both `connected: false`, and they say different
 * things: the store reports absence as `undefined` and corruption as its own message, and a reader deserves
 * to know which one it is looking at rather than being told to re-connect a door that IS connected.
 */
function readingFor({ door, home, read }: { door: string; home: string; read: GrantRead }): ConnectionRouteReading {
  const grant = read({ home });
  if (grant.isErr()) {
    return { connected: false, door, why: grant.error.join("; ") };
  }
  if (grant.value === undefined) {
    return { connected: false, door, why: `no ${door} grant is stored on this install` };
  }
  return { account: grant.value.account, connected: true, door };
}

/**
 * Grade the browser door on whether this machine has recorded which Chrome profile its legs read.
 *
 * Neither a grant nor a page: with no recorded profile the browser lane refuses to guess which of the owner's
 * profiles is the work one, so every leg this row advertises would refuse before opening anything. A store
 * that cannot be read grades the door unreachable with the store's own reason, never as connected.
 */
async function browserReading({
  home,
  profiles,
}: {
  home: string;
  profiles: RecordedProfilePort;
}): Promise<ConnectionRouteReading> {
  const recorded = await profiles.read({ home });
  if (recorded.isErr()) {
    return { connected: false, door: "browser", why: recorded.error.message };
  }
  if (recorded.value.directory === undefined) {
    return { connected: false, door: "browser", why: "no Chrome profile has been recorded on this machine" };
  }
  return { account: recorded.value.directory, connected: true, door: "browser" };
}

/**
 * Read and grade every door the given capability rows name.
 *
 * @param capabilities the merged capability table, whose door rows name what to read
 * @param home the state home the grants live under
 * @param profiles the door the recorded Chrome profile is read through, asked only when a row names the browser
 * @returns one grading per door, keyed by door name
 */
export async function connectionRouteReadings({
  capabilities,
  home,
  profiles,
}: {
  capabilities: readonly SourceCapability[];
  home: string;
  profiles: RecordedProfilePort;
}): Promise<ReadonlyMap<string, ConnectionRouteReading>> {
  const doors = [
    ...new Set(capabilities.flatMap((capability) => [connectionDoorOf({ capability })].filter((d) => d !== null))),
  ];
  const readings = new Map<string, ConnectionRouteReading>();
  for (const door of doors) {
    if (door === "browser") {
      readings.set(door, await browserReading({ home, profiles }));
      continue;
    }
    const read = GRANT_READ_BY_DOOR[door];
    if (read === undefined) {
      continue;
    }
    readings.set(door, readingFor({ door, home, read }));
  }
  return readings;
}

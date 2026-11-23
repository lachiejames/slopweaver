/**
 * The grant-bound seams every `calendar` write needs — the read API for snapshots, the write API, and the
 * zone the account reads in — resolved once per attempt from the stored grant.
 *
 * The zone degrades to {@link FALLBACK_ZONE} BY DESIGN, exactly as `calendar free` does: the account's own
 * zone lives behind `settings.get`, which the narrow `events` grant does not carry, and a write still has to
 * render its times in some zone when it cannot be read.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { makeCalendarApi } from "../../../live/calendar/api.js";
import { resolveCalendarClient } from "../../../live/calendar/client.js";
import type { CalendarError } from "../../../live/calendar/errors.js";
import { makeCalendarWriteApi } from "../../../live/calendar/writeApi.js";
import { calendarWritePrivacy } from "../../../outbound/calendar/writePrivacy.js";
import { FALLBACK_ZONE } from "./freeRun.js";

/** The account's own zone when the grant carries `settings` and Google answers, else the designed UTC degrade. */
async function accountZone({ api, home }: { api: ReturnType<typeof makeCalendarApi>; home: string }): Promise<string> {
  if (resolveCalendarClient({ capabilities: ["settings"], home }).isErr()) {
    return FALLBACK_ZONE;
  }
  const read = await api.getTimeZone();
  if (read.isErr()) {
    return FALLBACK_ZONE;
  }
  if (read.value === undefined) {
    return FALLBACK_ZONE;
  }
  return read.value;
}

/**
 * Bind a write's seams from the grant stored under `home`. Every write needs `events` (to read the target
 * back) AND `ownedEvents` (to change it); a grant missing either is refused here, before any form is read.
 *
 * @param home the state home the grant is stored under
 * @returns the account, both APIs and the zone, or the credential refusal
 */
export async function boundCalendarWriter({ home }: { home: string }): Promise<
  Result<
    {
      account: string;
      api: ReturnType<typeof makeCalendarApi>;
      writeApi: ReturnType<typeof makeCalendarWriteApi>;
      zone: string;
    },
    CalendarError
  >
> {
  const bound = resolveCalendarClient({ capabilities: ["events", "ownedEvents"], home });
  if (bound.isErr()) {
    return err(bound.error);
  }
  const { account, client } = bound.value;
  const api = makeCalendarApi({ account, client });
  const zone = await accountZone({ api, home });
  // The privacy policy is read from THIS home, afresh on every mutation, never an ambient one.
  const writeApi = makeCalendarWriteApi({ account, client, privacy: calendarWritePrivacy({ home }) });
  return ok({ account, api, writeApi, zone });
}

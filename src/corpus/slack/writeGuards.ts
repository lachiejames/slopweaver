/**
 * Every transport-level door a live Slack write transport crosses, composed in the one order they run.
 *
 * `./writeApi.ts`'s `makeSlackWriteTransport` is the only place a live transport is built, and it hands its raw
 * calls here. Wrapping at that one site rather than inside each `*Call` is what makes the doors
 * unroutable-around: a composer added later is guarded too. The order is cheapest refusal first. The typed-runs
 * door reads nothing. The high-stakes reply door (`./writeGuardHighStakes.ts`) reads one message back, and only
 * for a reply into a channel the profile names. The repeat door (`./writeGuardRepeat.ts`) reads the place every
 * guarded post lands. Innermost, the placement guard (`./writeGuardPlacement.ts`) reads every post BACK once it
 * has landed and moves or cross-links a misplaced one — innermost so only a post every door passed is read back,
 * and so its repair calls the raw transport rather than crossing a door a second time.
 */
import {
  guardHighStakesReplies,
  type HighStakesReplySeams,
  productionHighStakesReplySeams,
} from "./writeGuardHighStakes.js";
import {
  guardPlacement,
  PLACEMENT_OUT_OF_SCOPE,
  type PlacementGuardSeams,
  productionPlacementSeams,
} from "./writeGuardPlacement.js";
import { guardRepeats, productionRepeatSeams, type RepeatGuardSeams } from "./writeGuardRepeat.js";
import { guardTypedRuns } from "./writeGuardTypedRuns.js";
import type { SlackWriteTransport } from "./writeTransport.js";

/** The repeat door's seams: a test's own when it passed them, else the live ones for this token. */
function repeatSeamsFor({
  repeatSeams,
  token,
  home,
}: {
  repeatSeams: RepeatGuardSeams | undefined;
  token: string;
  home: string;
}): RepeatGuardSeams {
  if (repeatSeams !== undefined) {
    return repeatSeams;
  }
  return productionRepeatSeams({ home, token });
}

/** The high-stakes reply door's seams: a test's own when it passed them, else the lane's own home's profile. */
function highStakesSeamsFor({
  highStakesSeams,
  home,
}: {
  highStakesSeams: HighStakesReplySeams | undefined;
  home: string;
}): HighStakesReplySeams {
  if (highStakesSeams !== undefined) {
    return highStakesSeams;
  }
  return productionHighStakesReplySeams({ home });
}

/** The raw transport read back after each post — or left as it is, when the caller declared placement out of scope. */
function placed({
  transport,
  placementSeams,
  token,
  home,
}: {
  transport: SlackWriteTransport;
  placementSeams: PlacementGuardSeams | typeof PLACEMENT_OUT_OF_SCOPE | undefined;
  token: string;
  home: string;
}): SlackWriteTransport {
  if (placementSeams === PLACEMENT_OUT_OF_SCOPE) {
    return transport;
  }
  if (placementSeams !== undefined) {
    return guardPlacement({ seams: placementSeams, transport });
  }
  return guardPlacement({ seams: productionPlacementSeams({ home, token }), transport });
}

/**
 * Wrap a raw transport in every write door.
 *
 * @param transport the raw calls, one per method
 * @param token the bot token the transport writes as, which the live repeat and placement seams read with
 * @param home the state home the sending lane resolved, whose profile names the high-stakes channels and whose
 *   placement journal the read-back writes to
 * @param repeatSeams the repeat door's place, clock and hatch; the live ones for `token` when absent. A cassette
 *   or a replay passes its own, since neither recorded the door's reads.
 * @param highStakesSeams the high-stakes reply door's channel list and hatch; `home`'s profile when absent
 * @param placementSeams the read-back's thread reader, journal and clock; the live ones when absent, and
 *   {@link PLACEMENT_OUT_OF_SCOPE} from a cassette or replay that recorded no read-back
 * @returns the transport every live Slack write goes through
 */
export function guardWriteTransport({
  transport,
  token,
  home,
  repeatSeams,
  highStakesSeams,
  placementSeams,
}: {
  transport: SlackWriteTransport;
  token: string;
  home: string;
  repeatSeams: RepeatGuardSeams | undefined;
  highStakesSeams: HighStakesReplySeams | undefined;
  placementSeams: PlacementGuardSeams | typeof PLACEMENT_OUT_OF_SCOPE | undefined;
}): SlackWriteTransport {
  return guardTypedRuns({
    transport: guardHighStakesReplies({
      seams: highStakesSeamsFor({ highStakesSeams, home }),
      transport: guardRepeats({
        seams: repeatSeamsFor({ home, repeatSeams, token }),
        transport: placed({ home, placementSeams, token, transport }),
      }),
    }),
  });
}

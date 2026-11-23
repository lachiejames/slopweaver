/**
 * The herald before one of the plan call's unasked lines: the page is told which chime to ring
 * (`./announceCue.ts`, which holds the owner's ruling on the cue set), and the line waits {@link ANNOUNCE_LEAD_MS} so
 * the chime is heard before the voice is.
 *
 * Called after the line is claimed and its busy flag is held, so the floor refuses every other own line through the
 * lead. A scripted line does not read the floor again after it — the line was due when it was claimed, and a started
 * meeting cuts in anyway — while a once-only line (`./talkPlanOnceLines.ts`) reads `leadRefusal` and hands its claim
 * back unwritten when the owner started talking during the lead. The call ending during the lead is the write's own
 * `ended` answer, never a check here. Its own file so
 * `./talkPlanCall.ts` stays under the line cap.
 */
import { ANNOUNCE_LEAD_MS, type AnnounceCue } from "./announceCue";
import type { PlanEventRing } from "./talkPlanEventRing";
import type { CallClock } from "./talkPlanStart";

/** Ring one herald and resolve once its lead is up. */
export type Herald = (input: { readonly cue: AnnounceCue }) => Promise<void>;

/**
 * One call's {@link Herald}: tell every page listening to ring the cue, then wait out the lead on the call's clock. A
 * page reconnecting inside the lead is sent it too; one reconnecting after it never is, since the line it heralds is
 * already being said and the chime would ring over nothing.
 *
 * @param events the call's event stream
 * @param clock the call's clock, which a test's fake advances
 * @returns the herald
 */
export function heraldOf({ events, clock }: { events: PlanEventRing; clock: CallClock }): Herald {
  return async ({ cue }) => {
    const release = events.herald({ event: { cue, kind: "announce" } });
    await new Promise<void>((resolve) => {
      clock.after({ ms: ANNOUNCE_LEAD_MS, run: resolve });
    });
    release();
  };
}

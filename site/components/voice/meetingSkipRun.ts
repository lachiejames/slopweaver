/**
 * Run `meeting_skip` (`src/talk/meetingSkipToolSchemas.ts`): hold the meetings the owner told the voice they have
 * already had, or will not go to, so the page's meeting watch (`./useMeetingWatch.ts`) never raises a join heads-up
 * for them. Its own file so `talkToolRun.ts` stays under the line cap; every effect is a seam, so a test passes plain
 * fakes.
 *
 * A skip is bound to the owner's words the way a focus plan is: refused until they have said something final on this
 * call, so a skip never takes effect against what they said. The default stays that they attend every meeting; only
 * an exact calendar instance they ruled out is held
 * ([why](../../../docs/console/voice-notices-meetings.md)).
 */
import { bags } from "../../lib/bag";
import { MEETING_SKIPS_MAX, type MeetingSkip, meetingSkipOf } from "../../lib/meetingDue";

/** The most meetings one call may skip; `src/talk/meetingSkipToolSchemas.ts` declares the same bound to the model. */
const MEETING_SKIP_TARGETS_MAX = 8;

/** Where the skips live: the page's (`./useMeetingWatch.ts`), a plain fake in a test. */
export interface MeetingSkipSeams {
  /** The owner's newest final words on this call, `undefined` before they have said any. */
  readonly heard: () => string | undefined;
  readonly nowMs: () => number;
  readonly read: () => readonly MeetingSkip[];
  readonly write: (input: { readonly skips: readonly MeetingSkip[] }) => void;
}

/** What one `meeting_skip` call came to. */
export interface MeetingSkipRan {
  readonly answer: unknown;
  readonly detail: string;
  readonly refused: boolean;
}

/** The one key a skip is matched on: the calendar instance, never its title. */
const keyOf = ({ skip }: { skip: MeetingSkip }): string => JSON.stringify([skip.calendarId, skip.eventId]);

/**
 * Run one `meeting_skip` call: hold each named meeting as one the owner has had or will not go to, said now.
 *
 * @param args the tool call's arguments: `meetings`, each `{ calendarId, eventId, title }` off a calendar read
 * @param seams where the skips live, and the owner's words
 * @returns the answer, or why it was refused
 */
export function runMeetingSkip({
  args,
  seams,
}: {
  args: Record<string, unknown>;
  seams: MeetingSkipSeams;
}): MeetingSkipRan {
  const refused = ({ why }: { why: string }): MeetingSkipRan => ({
    answer: { refused: why },
    detail: why,
    refused: true,
  });
  const heard = seams.heard();
  if (heard === undefined || heard.trim() === "") {
    return refused({
      why: "the owner has said nothing on this call yet: a meeting is only skipped on their own words",
    });
  }
  const meetings = bags({ bag: args, key: "meetings" });
  if (meetings === undefined || meetings.length === 0 || meetings.length > MEETING_SKIP_TARGETS_MAX) {
    return refused({
      why: `meetings must list 1 to ${String(MEETING_SKIP_TARGETS_MAX)} meetings, each off a calendar read`,
    });
  }
  // One instant for the whole call: the page's receipt of the words the owner just finished.
  const saidAtMs = seams.nowMs();
  const named = new Map<string, MeetingSkip>();
  for (const meeting of meetings) {
    const skip = meetingSkipOf({
      value: { calendarId: meeting["calendarId"], eventId: meeting["eventId"], saidAtMs, title: meeting["title"] },
    });
    if (skip === undefined) {
      return refused({
        why: "every meeting needs the calendarId, eventId and title a calendar read printed for it",
      });
    }
    named.set(keyOf({ skip }), skip);
  }
  // A write only ever adds: no skip the owner made is dropped, evicted or replaced, so nothing they ruled out comes
  // back. Said again, the new instant sits beside the earlier one, whose reach a later stamp could narrow; a call
  // past the cap is refused instead of making room.
  const held = seams.read();
  const heldKeys = new Set(held.map((skip) => JSON.stringify([keyOf({ skip }), skip.saidAtMs])));
  const added = [...named.values()].filter((skip) => !heldKeys.has(JSON.stringify([keyOf({ skip }), skip.saidAtMs])));
  if (held.length + added.length > MEETING_SKIPS_MAX) {
    return refused({
      why: `the page already holds ${String(held.length)} meetings off, and holds at most ${String(MEETING_SKIPS_MAX)}`,
    });
  }
  seams.write({ skips: [...held, ...added] });
  const titles = [...named.values()].map((skip) => skip.title);
  return {
    answer: { skipped: titles, note: "say in a few words that you will not flag it, nothing more" },
    detail: `skipped: ${titles.join(", ")}`,
    refused: false,
  };
}

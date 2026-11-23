/**
 * `meeting_skip`: the meetings the owner told the voice they have already had, or will not go to, held by the page so
 * the meeting watch never raises a join heads-up for one. A measured call showed the failure: the owner had said a
 * meeting was done, and the voice still told them to join it.
 *
 * The model names each meeting by the exact calendar instance a `calendar list` read printed (its calendar id and event
 * id), never by its title alone, since two meetings can share a title inside a day. The page binds the call to the
 * owner's newest final words and the meeting-due route filters on it (`site/components/voice/meetingSkipRun.ts`,
 * `site/lib/meetingDueCandidates.ts`); the default stays that the owner attends every meeting
 * (`docs/console/voice-notices-meetings.md`).
 *
 * `"preference"`: it sets what the page announces for the owner, the way `focus_set` does, and writes, sends and reads
 * nothing else. The prompt lines live beside the schema, since this is one small capability.
 */
import type { TalkTool } from "./talkToolSchemas.js";

/** The most meetings one call may skip. Mirrors the page's own bound. */
const MEETING_SKIP_TARGETS_MAX = 8;

/** The longest calendar or event id. Mirrors the page's `NOTICE_ID_MAX_CHARS`. */
const MEETING_ID_MAX_CHARS = 1_024;

/** The longest title kept beside a skip. Mirrors the page's own cap. */
const MEETING_TITLE_MAX_CHARS = 200;

/** One bounded identifier. */
const id = { maxLength: MEETING_ID_MAX_CHARS, minLength: 1, type: "string" } as const;

/** The one meeting-skip tool, carried directly after the focus tools in both lists. */
export const MEETING_SKIP_TOOLS: readonly TalkTool[] = [
  {
    description:
      "Hold meetings the owner has already had, or will not go to, so you never tell them to join one: call it only " +
      "when the owner's final words on this call say so ('I already had the retro', 'I'm skipping standup', 'not " +
      "going to that one'). Read the owner's calendar first, every time, even when they name the meeting: verb " +
      "calendar list --json over the hours around now, then pass each meeting's calendarId and id (as eventId) and " +
      "its title exactly as that read printed them. The owner's words decide which meetings: 'all done for today' " +
      "covers only meetings the read shows that it plainly means, and finishing one meeting never skips a different " +
      "one. Unsure which meeting they mean: ask, and call nothing. After it, say in a few words that you will not flag it, nothing more.",
    kind: "preference",
    name: "meeting_skip",
    parameters: {
      additionalProperties: false,
      properties: {
        meetings: {
          items: {
            additionalProperties: false,
            properties: {
              calendarId: id,
              eventId: id,
              title: { maxLength: MEETING_TITLE_MAX_CHARS, minLength: 1, type: "string" },
            },
            required: ["calendarId", "eventId", "title"],
            type: "object",
          },
          maxItems: MEETING_SKIP_TARGETS_MAX,
          minItems: 1,
          type: "array",
        },
      },
      required: ["meetings"],
      type: "object",
    },
    summary: "hold a meeting the owner said they had or will skip, so no join heads-up comes for it",
  },
];

/** The voice's paragraph: hand the owner's word on a meeting to the thinking model, and never argue it. */
export const MEETING_SKIP_VOICE_LINES: readonly string[] = [
  "The owner goes to every meeting unless they say otherwise. When they say they already had one, or are not going",
  "('had the retro', 'skipping standup'), hand that to the thinking model at once so no join heads-up comes",
  "for it, and answer with a word or two. Never argue it, and never raise that meeting again yourself.",
];

/** The thinking model's bullet: when `meeting_skip` fires. */
export const MEETING_SKIP_BACKEND_LINES: readonly string[] = [
  "- A meeting the owner says they already had or will not go to: verb calendar list --json first, then meeting_skip",
  "  with each meeting's exact calendarId, id as eventId, and title from that read, only when THEIR words rule it",
  "  out. Never a meeting they did not name or plainly mean; unsure which, ask. The default is attending.",
];

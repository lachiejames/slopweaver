/**
 * The lines both Talk prompts carry (`./sessionConfig.ts`) for the page-held preferences: the owner's word on a meeting
 * (`./meetingSkipToolSchemas.ts`), then their stated plan and its wave-off (`./focusLines.ts`). One block because every
 * one of them sets only what the page announces for the owner and writes nothing they would call a steer, so `relay_steer`
 * stays the relay writer ([why](../../docs/console/voice-notices-meetings.md)).
 */
import { FOCUS_BACKEND_LINES, FOCUS_VOICE_LINES } from "./focusLines.js";
import { MEETING_SKIP_BACKEND_LINES, MEETING_SKIP_VOICE_LINES } from "./meetingSkipToolSchemas.js";

/** The voice's paragraphs, a blank line between them as the rest of its prompt is laid out. */
export const PREFERENCE_VOICE_LINES: readonly string[] = [...MEETING_SKIP_VOICE_LINES, "", ...FOCUS_VOICE_LINES];

/** The thinking model's bullets, one run. */
export const PREFERENCE_BACKEND_LINES: readonly string[] = [...MEETING_SKIP_BACKEND_LINES, ...FOCUS_BACKEND_LINES];

/**
 * Which surface one Talk conversation ran on: a voice call, or the orb messenger's typed box that drives the same
 * delegated thread by text, for an owner who may lose their voice. Both write the same
 * call file, so this is what tells a reader whether the owner's words were spoken or typed.
 */

/** The two surfaces, in the order a record reader prefers them when the field is absent. */
export const TALK_SURFACES = ["voice", "typed"] as const;

/** A voice call, or a typed conversation. */
export type TalkSurface = (typeof TALK_SURFACES)[number];

/**
 * The block a TYPED conversation adds to the backend prompt, last, so it overrides the voice-only lines above it.
 * The orb messenger's typed box drives this same thread with `turn/start` and no realtime voice, so nothing is spoken:
 * what the model writes is what the owner reads. A measured call had the voice tell the owner to "copy the link and
 * paste it here" and there was no here — so a link the owner pastes is the one to read.
 */
export const TALK_TYPED_INSTRUCTIONS = [
  "THIS CONVERSATION IS TYPED, NOT SPOKEN. The owner is typing into the console orb's messenger and reads your answer on",
  "screen; there is no voice and no microphone. Where the lines above say spoken, aloud, heard or say, read",
  "written, on screen, read and write.",
  "- The spoken length above does not bind here: short by default, cut nothing they act on.",
  "- Your final answer is what they read. Commentary before or between tool calls shows on screen as it is",
  "  written, so the walk's commentary question still works; keep it to that, never a line about what you are",
  "  about to do.",
  "- A link they pasted is the one to read: a Slack message link goes to slack_open for the whole thread (or",
  "  slack_thread_after when they ask only what came after that message), a pull request to verb github read. Never",
  "  ask them to paste a link they already did.",
  "- read_screen once, only when this message asks for a look; 'can you see it?' gets words. Refused: ask what they see, or its link.",
  "- Their running list is the same here as on a call: when they ask for a message to paste, offer_copy puts it on",
  "  the list, kept across calls and restarts, where they copy it with one click. No console line is added to a",
  "  typed answer, so once offer_copy has answered unrefused in this turn, and only then, say so in one short line.",
  "  When they say they put something on the list, or you are told it changed, read it with running_list.",
  "- A triage pass runs here exactly as on a call: 'it's triage time' is triage_next, and each card's TLDR and",
  "  their call are written. No 'time is up' reaches a typed conversation: the menu bar counts each card",
  "  down and chimes at zero, so never suggest a call on the clock unasked.",
  "- Plain text: the page draws no markdown, so no asterisks, backticks or headings. Short paragraphs, and where",
  "  there are several things one line each, opening with a bullet character. Keep ids out exactly as when spoken.",
].join("\n");

/**
 * `draft_edit_start`, `draft_edit` and `draft_restore`: the voice edits the parked Slack draft on the Queue card the
 * owner has open, live on the call, and never sends it. The voice has every capability for this live edit — the card
 * shows the voice working (a moving border, the owner's words quoted, its reading of them as a checklist), then reads
 * as v2 with v1 kept, and v1 comes back on the owner's word. Body only, Slack only, and kept simple.
 *
 * The page aims every one of them, never the model: the card is the one open on the owner's Queue (`?open=post:<id>`),
 * the quoted words are the owner's latest turn from the page's own transcript, and none of the three takes an id, an
 * anchor or the owner's words as an argument (`site/lib/draftEdit.ts`). `draft_edit` and `draft_restore` are the `"draft"` kind: they
 * write the local parked-draft register through `slack draft revise|restore`, which keep every version, refuse an
 * approved row, and fix where it goes, as whom, under which thread, with which files and whom it tags
 * (`src/cli/commands/slack/draftReviseRun.ts`). Sending stays the release command the card prints, on the owner's yes, unchanged. The
 * boundary is `docs/security/voice-boundary.md` § "The one draft write".
 *
 * None of the three names `slack draft` as a verb it runs or stands in for (`TalkTool.runs`, `standsInFor`): that
 * verb records, approves and releases too, none of them the voice's, so the reach block keeps saying the voice cannot
 * run it, and the three tools say for themselves what they do in the inventory both prompts carry.
 */
import { REVISION_READING_MAX_CHARS, REVISION_READING_MAX_ITEMS } from "../outbound/slack/draftRevision.js";
import type { TalkTool } from "./talkToolSchemas.js";

/** The voice's line: an edit the owner asks for on the open draft is made, on the owner's card, and never sent. */
export const DRAFT_EDIT_VOICE_LINES: readonly string[] = [
  "When the owner asks to change the words of the parked Slack draft on the open card ('make it warmer', 'cut",
  "the last line', 'put it back'), that edit is made on the card while you talk: say in a few words what you",
  "are changing, then that it is done. Never read the new words out, never say it was sent: it waits for the owner's yes.",
];

/** The thinking model's bullet: start, write the whole message, restore by number, never relay or send it. */
export const DRAFT_EDIT_BACKEND_LINES: readonly string[] = [
  "- The owner asks to change the words of the parked Slack draft on the open card: draft_edit_start first,",
  "  `reading` your one-to-five-line reading of the ask, so the card shows it; then draft_edit with the WHOLE new",
  "  message, edited from the text it returned. The owner's next change is a fresh draft_edit_start. 'Put it back', 'the",
  "  first one was better': draft_restore with that version. These replace relay_steer and offer_copy for that",
  "  ask — never also relay it, and never send it: it waits for the owner's yes on the card. A refusal: say why briefly.",
];

/** The three draft tools, carried directly after the card tools in both lists, in the order a call uses them. */
export const DRAFT_TOOLS: readonly TalkTool[] = [
  {
    description:
      "Start editing the parked Slack draft on the Queue card the owner has open, when the owner asks you to change its words. " +
      "Call it FIRST, before you write anything: the owner's card shows that you are editing, with the owner's words quoted and " +
      "your reading of them as a checklist. `reading` is that checklist: one to " +
      `${String(REVISION_READING_MAX_ITEMS)} short lines of what you will change, in your words, each at most ` +
      `${String(REVISION_READING_MAX_CHARS)} characters. The page picks the card (the one open on the owner's Queue) and ` +
      "quotes the owner from the call itself; you never name either. Returns the draft's words as text — the source you " +
      "edit — and which version it is. Refused when the open card is not a held parked draft that posts as the owner.",
    kind: "read",
    name: "draft_edit_start",
    summary: "start a live edit of the parked Slack draft on the open card: the card shows you working",
    parameters: {
      additionalProperties: false,
      properties: {
        reading: {
          description: "What you will change, one short line each.",
          items: { maxLength: REVISION_READING_MAX_CHARS, minLength: 1, type: "string" },
          maxItems: REVISION_READING_MAX_ITEMS,
          minItems: 1,
          type: "array",
        },
      },
      required: ["reading"],
      type: "object",
    },
  },
  {
    description:
      "Write the new words of the draft draft_edit_start opened, as the WHOLE message: every line, not a diff. " +
      "Write it in the shape draft_edit_start returned: a drip as its one line, a line starting " +
      "'- ' per bullet, *bold*, `code`, <https://url|label> for a link, and every tag exactly as it appears there " +
      "(<@person>); a tag or a link is never bold. Drop a tag if the owner asks; never add or repeat one, nor an @here. Where it goes, as whom, its thread and its files stay as they " +
      "are. It never sends: the card reads as the next version with the earlier ones kept, and it still waits for " +
      "the owner's yes. Refused, say why in a few words and offer the fix.",
    kind: "draft",
    name: "draft_edit",
    summary: "rewrite the open parked draft's words as the next version, every earlier one kept; never sends",
    parameters: {
      additionalProperties: false,
      properties: { text: { description: "The whole new message.", minLength: 1, type: "string" } },
      required: ["text"],
      type: "object",
    },
  },
  {
    description:
      "Put an earlier version of the open parked draft back, when the owner asks ('put it back', 'go back to the first " +
      "one'): it becomes the next version, nothing is deleted. `version` is the number draft_edit_start or " +
      "draft_edit gave, 1 being the words the owner first saw. It never sends.",
    kind: "draft",
    name: "draft_restore",
    summary: "put an earlier version of the open parked draft back, as the next version; never sends",
    parameters: {
      additionalProperties: false,
      properties: { version: { minimum: 1, type: "integer" } },
      required: ["version"],
      type: "object",
    },
  },
];

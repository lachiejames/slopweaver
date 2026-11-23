/**
 * `focus_screen`: on the owner's ask, the voice lifts one region of the picture `read_screen` just took and the
 * desktop app dims the rest of the owner's screen, so "click that thing there" has a "there" the owner can see. The
 * rule: when the owner is stuck on a page with the voice on a call, the voice brings a certain section of the screen
 * into focus and blurs out everything else, and does so only when asked to show, because otherwise it gets really
 * annoying, really fast.
 *
 * It is the one `"show"` tool: it draws on the owner's own screen and nothing else — it reads nothing, writes nothing
 * and sends nothing off the machine, so it is neither a relay read nor a writer. The page's gate
 * (`site/lib/screenFocus.ts`) decides whether the owner asked, never the model.
 */
import type { TalkTool } from "./talkToolSchemas.js";

/** The screen-focus tool, carried directly after `read_screen` in both lists. */
export const SCREEN_TOOLS: readonly TalkTool[] = [
  {
    description:
      "In the desktop app, lift ONE region of the picture read_screen just took and dim the rest of the owner's " +
      "screen, so they see which thing you mean. Call it only when the owner asks to be shown where or which (show " +
      "me, where is it, which one, point to it, highlight it), only after read_screen on that same ask, once per " +
      "ask, never on your own initiative. x, y, width and height are pixels of that picture at the size it was sent " +
      "at, boxing the one thing tightly. It drops when the owner speaks or taps. If it is refused, say where it is in words.",
    kind: "show",
    name: "focus_screen",
    summary: "lift one region of the screen and dim the rest, only when the owner asks to be shown",
    parameters: {
      additionalProperties: false,
      properties: {
        height: { description: "Box height in pixels of the read_screen picture.", type: "integer" },
        width: { description: "Box width in pixels of the read_screen picture.", type: "integer" },
        x: { description: "Box left edge in pixels of the read_screen picture.", type: "integer" },
        y: { description: "Box top edge in pixels of the read_screen picture.", type: "integer" },
      },
      required: ["x", "y", "width", "height"],
      type: "object",
    },
  },
];

/** The thinking model's lines on pointing: read_screen, then focus_screen, then one short line — only on the owner's ask. */
export const SCREEN_FOCUS_BACKEND_LINES: readonly string[] = [
  "- 'show me where', 'which one', 'point to it', 'highlight it' about something on the screen: read_screen,",
  "  then focus_screen boxing that one thing in the picture's sent-at pixels, then one short line ('this one, top right').",
  "  Only when the owner asks to be shown, once per ask, never on your own initiative; if it is refused, say where in words.",
];

/** The voice's lines on pointing: hand the ask over, say one short line, never offer it. */
export const SCREEN_FOCUS_VOICE_LINES: readonly string[] = [
  "When the owner asks you to show where or which thing on their screen, hand it to the thinking model; once it says the",
  "region is lifted, say one short line ('this one here'). Never offer to highlight anything, and never on your own.",
];

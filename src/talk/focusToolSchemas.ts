/**
 * `focus_set`, `focus_end` and `focus_quiet`: what the owner said they would do, held by the page so the voice can tell
 * the owner when what is in front of them has drifted from it ("by the way, you said you were going to do this, but
 * you're actually doing that"). The owner may wave the nudge off, but being notified is still useful.
 *
 * The model names the plan and what counts as doing it ONCE, here; the page then matches the front window against it
 * deterministically (`site/lib/driftWatch.ts`), and the line itself is the server's fixed sentence, spoken rather than
 * prompted (`site/lib/talkPlanWords.ts` `driftSpeech`). So nothing about a sample ever reaches a model.
 *
 * All three are `"preference"`: they set what the page watches for the owner on this call, the way a stage switch does, and
 * write, send and read nothing else.
 */
import type { TalkTool } from "./talkToolSchemas.js";

/** The longest plan label: it completes "you said you'd …", one short spoken phrase. Mirrors the page's own cap. */
const PLAN_MAX_CHARS = 80;

/** The most application names one plan may hold. */
const FOCUS_MAX_APPS = 8;

/** The most title words one plan may hold. */
const FOCUS_MAX_KEYWORDS = 12;

/** The longest application name or title word. */
const FOCUS_TERM_MAX_CHARS = 60;

/** A JSON-schema object with no properties. */
const NO_ARGUMENTS = { additionalProperties: false, properties: {}, required: [], type: "object" } as const;

/** One list of short terms. */
const terms = ({ maxItems }: { maxItems: number }) =>
  ({ items: { maxLength: FOCUS_TERM_MAX_CHARS, minLength: 1, type: "string" }, maxItems, type: "array" }) as const;

/** The three focus tools, carried directly after `set_stage_setting` in both lists. */
export const FOCUS_TOOLS: readonly TalkTool[] = [
  {
    description:
      "Hold what the owner just said they would do, so you are told if they drift from it: call it when the OWNER's words on this " +
      "call commit to a stretch of work ('I'll do the ISO review first', 'next hour is the access audit'), never " +
      "for a plan you suggested that the owner did not take up. plan completes 'you said you'd …' in the owner's terms, a few " +
      "words ('do the ISO access review'). apps are the macOS application names the work happens in ('Linear', " +
      "'Visual Studio Code', 'Vanta' only if it is an app) — never a browser, since a browser holds anything. " +
      "keywords are short words or phrases a window title would carry while the owner does it ('ISO', 'access " +
      "review', a repository or ticket name). Give at least one of apps or keywords. A second call replaces the " +
      "plan. After it, say in a few words that you will nudge the owner if they drift, nothing more.",
    kind: "preference",
    name: "focus_set",
    parameters: {
      additionalProperties: false,
      properties: {
        apps: terms({ maxItems: FOCUS_MAX_APPS }),
        keywords: terms({ maxItems: FOCUS_MAX_KEYWORDS }),
        plan: { maxLength: PLAN_MAX_CHARS, minLength: 1, type: "string" },
      },
      required: ["plan", "apps", "keywords"],
      type: "object",
    },
    summary: "hold the owner's stated plan, and nudge once if what is on screen drifts from it",
  },
  {
    description:
      "Drop the plan focus_set holds: call it when the owner says they are done with it, have changed what they are doing, or " +
      "wants no more nudges at all ('stop watching', 'I'm done with that'). Then say a word or two.",
    kind: "preference",
    name: "focus_end",
    parameters: NO_ARGUMENTS,
    summary: "drop the stated plan, so no drift nudge comes",
  },
  {
    description:
      "The owner waved off a drift nudge ('shut up', 'I know', 'I'll do what I want', 'this is fine'): call it at once. " +
      "The window that nudge named is never named again for this plan, and every nudge is quiet for half an " +
      "hour; the plan stays. Answer with a word or two, never an argument and never a reminder of the plan.",
    kind: "preference",
    name: "focus_quiet",
    parameters: NO_ARGUMENTS,
    summary: "a drift nudge was waved off: accept that window, and quiet nudges for a while",
  },
];

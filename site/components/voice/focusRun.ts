/**
 * Run `focus_set`, `focus_end` and `focus_quiet` (`src/talk/focusToolSchemas.ts`) over the page's drift watch
 * (`../../lib/driftWatch.ts`, held by `./useFrontWindowNotices.ts`). Its own file so `talkToolRun.ts` stays under the
 * line cap; every effect is a seam, so a test passes plain fakes.
 *
 * A plan is bound to the OWNER's words: `focus_set` is refused until the owner has said something final on this call,
 * and the plan keeps their newest words beside the model's label, so what the watch holds traces to what they said.
 */
import { boundedDriftField, DRIFT_PLAN_MAX_CHARS } from "../../lib/driftNotice";
import {
  comparable,
  type DriftWatchInput,
  type DriftWatchState,
  type FocusPlan,
  isBrowserName,
} from "../../lib/driftWatch";
import type { HeardSegment } from "../../lib/voiceTranscript";

/** The most application names one plan may hold; `src/talk/focusToolSchemas.ts` declares the same bound to the model. */
const FOCUS_MAX_APPS = 8;

/** The most title words one plan may hold. */
const FOCUS_MAX_KEYWORDS = 12;

/** The longest application name or title word. */
const FOCUS_TERM_MAX_CHARS = 60;

/** The longest record of the owner's words a plan keeps. */
const HEARD_MAX_CHARS = 400;

/** Where the watch lives: the page's (`./useFrontWindowNotices.ts`), a plain fake in a test. */
export interface FocusSeams {
  readonly read: () => DriftWatchState;
  readonly apply: (input: { readonly input: DriftWatchInput }) => void;
  /** The owner's newest final words on this call, `undefined` before any. */
  readonly heard: () => string | undefined;
  /** Whether the desktop app this page runs in can read which window is in front. */
  readonly canWatch: () => boolean;
  readonly nowMs: () => number;
}

/** What one focus call came to. */
export interface FocusRan {
  readonly answer: unknown;
  readonly detail: string;
  readonly refused: boolean;
}

/**
 * The owner's newest finished words on the call: what a plan is bound to, so it traces to something they said.
 *
 * @param segments the conversation, oldest first
 * @returns the text of the owner's newest final turn, or `undefined` before one is finished
 */
export function newestFinalWordsOf({ segments }: { segments: readonly HeardSegment[] }): string | undefined {
  return segments.findLast((segment) => segment.who === "owner" && segment.final && segment.text.trim() !== "")?.text;
}

/**
 * A list of short terms, each bounded and compared lowercased, or why not.
 *
 * @param value the argument as the model sent it
 * @param name the argument's name, for the refusal
 * @param maxItems how many it may hold
 * @returns the comparable terms, or why they were refused
 */
function termsOf({
  value,
  name,
  maxItems,
}: {
  value: unknown;
  name: string;
  maxItems: number;
}): { readonly terms: readonly string[] } | { readonly why: string } {
  if (!Array.isArray(value) || value.length > maxItems) {
    return { why: `${name} must be a list of at most ${String(maxItems)} short words` };
  }
  const terms: string[] = [];
  for (const item of value) {
    const term = boundedDriftField({ maxChars: FOCUS_TERM_MAX_CHARS, value: item });
    if (term === undefined) {
      return { why: `every one of ${name} must be a short word or phrase` };
    }
    terms.push(comparable({ text: term }));
  }
  return { terms: [...new Set(terms)] };
}

/**
 * Run one `focus_set` call: hold the plan the owner stated, replacing any before it.
 *
 * @param args the tool call's arguments: `plan`, `apps`, `keywords`
 * @param seams the watch
 * @returns the answer, or why it was refused
 */
export function runFocusSet({ args, seams }: { args: Record<string, unknown>; seams: FocusSeams }): FocusRan {
  const refused = ({ why }: { why: string }): FocusRan => ({ answer: { refused: why }, detail: why, refused: true });
  if (!seams.canWatch()) {
    return refused({
      why: "only the Slopweaver desktop app can see which window is in front, so no nudge can come here",
    });
  }
  const heard = boundedDriftField({ maxChars: HEARD_MAX_CHARS, value: seams.heard() });
  if (heard === undefined) {
    return refused({ why: "the owner has said nothing on this call yet: a plan is only ever their own words" });
  }
  const plan = boundedDriftField({ maxChars: DRIFT_PLAN_MAX_CHARS, value: args["plan"] });
  if (plan === undefined) {
    return refused({ why: "plan must complete 'you said you'd …' in a few words" });
  }
  const apps = termsOf({ maxItems: FOCUS_MAX_APPS, name: "apps", value: args["apps"] });
  if ("why" in apps) {
    return refused({ why: apps.why });
  }
  const browser = apps.terms.find((app) => isBrowserName({ name: app }));
  if (browser !== undefined) {
    return refused({ why: `${browser} is a browser, which holds anything: name a title keyword instead` });
  }
  const keywords = termsOf({ maxItems: FOCUS_MAX_KEYWORDS, name: "keywords", value: args["keywords"] });
  if ("why" in keywords) {
    return refused({ why: keywords.why });
  }
  if (apps.terms.length === 0 && keywords.terms.length === 0) {
    return refused({ why: "give at least one app or title keyword that means the owner is doing it" });
  }
  const held: FocusPlan = { apps: apps.terms, heard, keywords: keywords.terms, plan };
  seams.apply({ input: { kind: "set", plan: held } });
  return {
    answer: { holding: plan, note: "say in a few words that you will nudge the owner if they drift, nothing more" },
    detail: `holding: ${plan}`,
    refused: false,
  };
}

/**
 * Run one `focus_end` call: drop the plan.
 *
 * @param seams the watch
 * @returns the answer, or why it was refused
 */
export function runFocusEnd({ seams }: { seams: FocusSeams }): FocusRan {
  const plan = seams.read().plan;
  if (plan === undefined) {
    const why = "no plan is held: focus_set holds one";
    return { answer: { refused: why }, detail: why, refused: true };
  }
  seams.apply({ input: { kind: "end" } });
  return { answer: { dropped: plan.plan }, detail: `dropped: ${plan.plan}`, refused: false };
}

/**
 * Run one `focus_quiet` call: accept the window the last nudge named, and quiet every nudge for a while.
 *
 * @param seams the watch
 * @returns the answer, or why it was refused
 */
export function runFocusQuiet({ seams }: { seams: FocusSeams }): FocusRan {
  if (seams.read().plan === undefined) {
    const why = "no plan is held, so there is no nudge to quiet";
    return { answer: { refused: why }, detail: why, refused: true };
  }
  seams.apply({ input: { kind: "quiet", nowMs: seams.nowMs() } });
  return {
    answer: { quiet: "that window is fine for this plan, and nudges are quiet for half an hour" },
    detail: "nudges quiet",
    refused: false,
  };
}

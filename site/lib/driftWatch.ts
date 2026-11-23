/**
 * Whether what the owner is doing has drifted from what they said they would do — the pure half of the page's drift
 * watch (`../components/voice/useFrontWindowNotices.ts`). Like the meeting-start nudge, the voice interjects once to
 * say the owner is doing something other than what they said they would, and the owner may wave it off; being
 * notified is still useful.
 *
 * **The judge is set once, when the owner states the plan, never per sample.** The thinking model names the applications and
 * window-title words that are on-plan (`focus_set`); after that a sample is matched here, deterministically, so a
 * window that fits says nothing at all — a model asked to stay silent does not reliably stay silent
 * (`./talkPlanWords.ts`, the resume variant that still said "Got it."). A browser is on-plan only by a title word,
 * never by its name, and Slopweaver itself always is: the owner is talking to it.
 *
 * **The signal is metadata, never a frame.** A sample is the frontmost application and its window's title, which the
 * desktop shell reads every {@link FRONT_WINDOW_POLL_MS} while a plan is held and a call is live; it never leaves the
 * page. The rule that no frame is sampled on a timer stands untouched (`docs/console/`'s "The voice sees the owner's screen" page).
 *
 * Pure: no clock, no I/O, no id minting — the hook hands each in.
 */
import { isBag } from "./bag";
import { DRIFT_APP_MAX_CHARS, DRIFT_MAX_MINUTES, type DriftNotice } from "./driftNotice";

/** How often the frontmost window is read while a plan is held and a call is live. */
export const FRONT_WINDOW_POLL_MS = 15_000;

/** How long one off-plan window must stay frontmost before the owner is told: a glance at Slack is not drift. */
export const DRIFT_DWELL_MS = 3 * 60_000;

/** How soon a line the floor refused, or whose answer was lost, is posted again while it is still owed. */
export const DRIFT_RETRY_MS = 4_000;

/** How long after one line before another is owed, however long the drift runs on. */
export const DRIFT_COOLDOWN_MS = 10 * 60_000;

/** How long the owner's wave-off quiets every line: being told is the point, so it is a pause, never an off switch. */
export const DRIFT_QUIET_MS = 30 * 60_000;

/** The frontmost application and its window's title, as the desktop shell read it. */
export interface FrontWindowActivity {
  readonly app: string;
  readonly bundleId: string | null;
  /** `null` when macOS would not give the title — Screen Recording off — or the window has none. */
  readonly title: string | null;
}

/** What the owner said they would do, and what counts as doing it. */
export interface FocusPlan {
  /** What completes "you said you'd …", in the owner's terms. */
  readonly plan: string;
  /** Application names that are on-plan, lowercased; never a browser. */
  readonly apps: readonly string[];
  /** Window-title words that make any application on-plan, lowercased. */
  readonly keywords: readonly string[];
  /** The owner's newest final words when the plan was set: the record of what they said, beside the model's label. */
  readonly heard: string;
}

/** One off-plan window, frontmost since its first sample. */
interface DriftCandidate {
  readonly key: string;
  readonly app: string;
  readonly firstSeenMs: number;
  /** Minted once the dwell is reached, and kept through every retry. */
  readonly noticeId: string | undefined;
}

/** The watch, between samples. */
export interface DriftWatchState {
  readonly plan: FocusPlan | undefined;
  /** The newest sample's key, `undefined` when it was unreadable or none was taken. */
  readonly frontKey: string | undefined;
  readonly candidate: DriftCandidate | undefined;
  /** Windows the owner waved a line off for, by key: never named again for this plan. */
  readonly accepted: readonly string[];
  /** The window the newest said line named, by key — what a wave-off accepts. */
  readonly lastToldKey: string | undefined;
  readonly cooldownUntilMs: number;
  readonly quietUntilMs: number;
}

/** What moves the watch. */
export type DriftWatchInput =
  | { readonly kind: "set"; readonly plan: FocusPlan }
  | { readonly kind: "end" }
  | { readonly kind: "quiet"; readonly nowMs: number }
  | {
      readonly kind: "sample";
      readonly activity: FrontWindowActivity | undefined;
      readonly nowMs: number;
      /** A fresh id, taken only when this sample is the one that reaches the dwell. */
      readonly freshId: string;
    }
  | { readonly kind: "told"; readonly noticeId: string; readonly nowMs: number };

/** A watch with no plan. */
export const IDLE_DRIFT_WATCH: DriftWatchState = {
  accepted: [],
  candidate: undefined,
  cooldownUntilMs: 0,
  frontKey: undefined,
  lastToldKey: undefined,
  plan: undefined,
  quietUntilMs: 0,
};

/** Browsers by bundle id: one is on-plan only through a title word, since a browser holds anything. */
const BROWSER_BUNDLES = new Set([
  "com.apple.safari",
  "com.google.chrome",
  "com.google.chrome.canary",
  "company.thebrowser.browser",
  "org.mozilla.firefox",
  "com.microsoft.edgemac",
  "com.brave.browser",
]);

/** Browsers by name, for a sample with no bundle id. */
const BROWSER_NAMES = new Set([
  "safari",
  "google chrome",
  "chrome",
  "arc",
  "firefox",
  "microsoft edge",
  "brave browser",
]);

/** The desktop app's own bundle id. */
const SLOPWEAVER_BUNDLE = "ai.slopweaver.desktop";

/**
 * Text as it is compared: control characters gone, whitespace collapsed, lowercased.
 *
 * @returns the comparable form
 */
export function comparable({ text }: { text: string }): string {
  return text
    .replaceAll(/\p{Cc}/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

/**
 * One sample off the shell (`desktop/src/frontWindow.ts` `FrontWindowReply`): exactly an application name with a
 * bundle id and a title, each a string or `null`. A refusal — no call up, the owner's screen locked, the read failed — or
 * anything else is no sample, which starts any dwell again rather than counting toward it.
 *
 * @param value what the shell's `frontWindow` resolved to
 * @returns the sample, or `undefined` when there is none
 */
export function frontWindowActivityOf({ value }: { value: unknown }): FrontWindowActivity | undefined {
  if (!isBag(value)) {
    return undefined;
  }
  const { app, bundleId, title } = value;
  if (Object.keys(value).length !== 3 || typeof app !== "string" || app.trim() === "") {
    return undefined;
  }
  const textOrNull = (field: unknown): field is string | null => field === null || typeof field === "string";
  if (!textOrNull(bundleId) || !textOrNull(title)) {
    return undefined;
  }
  return { app, bundleId, title };
}

/**
 * Whether a sample is a browser.
 *
 * @param activity the sample
 * @returns true for a known browser, by bundle id or by name
 */
export function isBrowser({ activity }: { activity: FrontWindowActivity }): boolean {
  if (activity.bundleId !== null && BROWSER_BUNDLES.has(activity.bundleId.toLowerCase())) {
    return true;
  }
  return BROWSER_NAMES.has(comparable({ text: activity.app }));
}

/**
 * Whether a name is a browser's: what `focus_set` refuses in its application list.
 *
 * @param name an application name
 * @returns true for a known browser name
 */
export function isBrowserName({ name }: { name: string }): boolean {
  return BROWSER_NAMES.has(comparable({ text: name }));
}

/**
 * Whether a sample is Slopweaver itself — the console or the voice — which is always on-plan, and which the ISO watch
 * (`./isoStrayWatch.ts`) judges by the card open in it rather than by its window.
 *
 * @param activity the sample
 * @returns true for the desktop app, by bundle id or by its name
 */
export function activityIsSlopweaver({ activity }: { activity: FrontWindowActivity }): boolean {
  if (activity.bundleId?.toLowerCase() === SLOPWEAVER_BUNDLE) {
    return true;
  }
  const app = comparable({ text: activity.app });
  return app === "slopweaver" || app.startsWith("slopweaver ");
}

/**
 * Whether a title holds a keyword as a whole phrase: "ISO" is in "ISO 27001 controls", never in "isomorphic".
 *
 * @param title the comparable title
 * @param keyword the comparable keyword
 * @returns true when the keyword stands on its own in the title
 */
export function titleHolds({ title, keyword }: { title: string; keyword: string }): boolean {
  let from = title.indexOf(keyword);
  while (from !== -1) {
    const before = title.slice(0, from).at(-1);
    const after = title.at(from + keyword.length);
    const edge = (char: string | undefined): boolean => char === undefined || !/[\p{L}\p{N}]/u.test(char);
    if (edge(before) && edge(after)) {
      return true;
    }
    from = title.indexOf(keyword, from + 1);
  }
  return false;
}

/**
 * Whether a sample fits the plan: Slopweaver, a named application that is not a browser, or a title word.
 *
 * @param activity the sample
 * @param plan the plan the owner stated
 * @returns true when the sample is on-plan
 */
export function activityOnPlan({ activity, plan }: { activity: FrontWindowActivity; plan: FocusPlan }): boolean {
  if (activityIsSlopweaver({ activity })) {
    return true;
  }
  if (!isBrowser({ activity }) && plan.apps.includes(comparable({ text: activity.app }))) {
    return true;
  }
  if (activity.title === null) {
    return false;
  }
  const title = comparable({ text: activity.title });
  return plan.keywords.some((keyword) => keyword !== "" && titleHolds({ keyword, title }));
}

/**
 * The key one window is known by: its application and its title, so a new tab or document starts a new dwell.
 *
 * @param activity the sample
 * @returns the key
 */
export function activityKeyOf({ activity }: { activity: FrontWindowActivity }): string {
  const title = activity.title === null ? null : comparable({ text: activity.title });
  return JSON.stringify([comparable({ text: activity.app }), activity.bundleId, title]);
}

/**
 * The watch after one sample.
 *
 * @param state the watch before it
 * @param activity the sample, `undefined` when it could not be read
 * @param nowMs when it was taken
 * @param freshId an id for a drift this sample brings due
 * @returns the watch after it
 */
function sampled({
  state,
  activity,
  nowMs,
  freshId,
}: {
  state: DriftWatchState;
  activity: FrontWindowActivity | undefined;
  nowMs: number;
  freshId: string;
}): DriftWatchState {
  if (state.plan === undefined) {
    return state;
  }
  if (activity === undefined) {
    return { ...state, candidate: undefined, frontKey: undefined };
  }
  const key = activityKeyOf({ activity });
  if (activityOnPlan({ activity, plan: state.plan }) || state.accepted.includes(key)) {
    return { ...state, candidate: undefined, frontKey: key };
  }
  const held = state.candidate?.key === key ? state.candidate : undefined;
  if (held === undefined) {
    const app = activity.app.slice(0, DRIFT_APP_MAX_CHARS);
    return { ...state, candidate: { app, firstSeenMs: nowMs, key, noticeId: undefined }, frontKey: key };
  }
  if (held.noticeId === undefined && nowMs - held.firstSeenMs >= DRIFT_DWELL_MS) {
    return { ...state, candidate: { ...held, noticeId: freshId }, frontKey: key };
  }
  return { ...state, frontKey: key };
}

/**
 * The watch after one input.
 *
 * @param state the watch before it
 * @param input what happened: a plan set, ended or waved off, a sample, a line said
 * @returns the watch after it
 */
export function foldDriftWatch({ state, input }: { state: DriftWatchState; input: DriftWatchInput }): DriftWatchState {
  switch (input.kind) {
    case "set": {
      return { ...IDLE_DRIFT_WATCH, plan: input.plan };
    }
    case "end": {
      return IDLE_DRIFT_WATCH;
    }
    case "quiet": {
      if (state.plan === undefined) {
        return state;
      }
      const told = state.lastToldKey;
      const accepted = told === undefined || state.accepted.includes(told) ? state.accepted : [...state.accepted, told];
      const candidate = state.candidate?.key === told ? undefined : state.candidate;
      return { ...state, accepted, candidate, quietUntilMs: input.nowMs + DRIFT_QUIET_MS };
    }
    case "sample": {
      return sampled({ activity: input.activity, freshId: input.freshId, nowMs: input.nowMs, state });
    }
    case "told": {
      if (state.candidate?.noticeId !== input.noticeId) {
        return state;
      }
      // The window keeps its first sample, so a second line after the cooldown names the whole stretch, never the tail.
      return {
        ...state,
        candidate: { ...state.candidate, noticeId: undefined },
        cooldownUntilMs: input.nowMs + DRIFT_COOLDOWN_MS,
        lastToldKey: state.candidate.key,
      };
    }
    default: {
      const unreachable: never = input;
      return unreachable;
    }
  }
}

/**
 * The line owed now, if one is: a plan held, one off-plan window frontmost past the dwell and still frontmost, and
 * neither a cooldown nor the owner's wave-off running.
 *
 * @param state the watch
 * @param nowMs the instant judged at
 * @returns the notice to post, or `undefined`
 */
export function driftOwed({ state, nowMs }: { state: DriftWatchState; nowMs: number }): DriftNotice | undefined {
  const { plan, candidate } = state;
  if (plan === undefined || candidate?.noticeId === undefined || candidate.key !== state.frontKey) {
    return undefined;
  }
  if (nowMs < state.cooldownUntilMs || nowMs < state.quietUntilMs) {
    return undefined;
  }
  const elapsed = Math.floor((nowMs - candidate.firstSeenMs) / 60_000);
  const minutes = Math.min(DRIFT_MAX_MINUTES, Math.max(DRIFT_DWELL_MS / 60_000, elapsed));
  return { app: candidate.app, minutes, noticeId: candidate.noticeId, plan: plan.plan };
}

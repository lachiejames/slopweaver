/**
 * The orb's FACE: which of its moods it wears, and which badge sits on it, read off what the voice is doing.
 *
 * The face of the supervisor the owner is talking to is expressive while talking, thinking and looking at the
 * owner's screen: a Slack icon when it looks at Slack, an eyeballs emoji when it looks at the screen, a bounce or a
 * shimmer to say more.
 *
 * So the phase `voiceStatusOf` (`./voiceActivity.ts`) already decides stays the decision, and this module only
 * NAMES it more finely: a working phase becomes thinking, writing, or the kind of thing the tool in flight does —
 * the owner's screen, Slack, the code, its memory, the owner's browser, a relay. Nothing here feeds back into the call; it is read
 * by `components/voice/VoiceWidget.tsx` to pick a colour, a motion and a badge, and the LIVE face's badge — never a
 * preview's — picks the orb's sound (`./orbCue.ts`).
 *
 * The badge is the work in flight, so it rides over speaking and hearing too: "one sec, pulling that up" said over
 * `read_screen` is the speaking orb with 👀 on it.
 */
import type { WorkStep } from "./responsesStep";
import type { VoicePhase, VoiceStatus } from "./voiceActivity";

/** Every mood the orb can wear. */
export const ORB_MOODS = [
  "off",
  "connecting",
  "reconnecting",
  "idle",
  "hearing",
  "yielded",
  "speaking",
  "thinking",
  "writing",
  "looking",
  "slack",
  "code",
  "recalling",
  "browsing",
  "relaying",
  "working",
  "stalled",
  "error",
] as const;

/** One of {@link ORB_MOODS}. */
export type OrbMood = (typeof ORB_MOODS)[number];

/** The moods that are a piece of WORK, and so may sit on the orb as a badge whatever its own mood. */
export type WorkMood = Extract<
  OrbMood,
  "thinking" | "writing" | "looking" | "slack" | "code" | "recalling" | "browsing" | "relaying" | "working"
>;

/** A badge: a piece of work, or the two states that are not work but still want a mark. */
export type OrbBadge = WorkMood | "stalled" | "error";

/** Every badge, for reading one off a preview. */
export const ORB_BADGES: readonly OrbBadge[] = [
  "thinking",
  "writing",
  "looking",
  "slack",
  "code",
  "recalling",
  "browsing",
  "relaying",
  "working",
  "stalled",
  "error",
];

/** What the orb wears. */
export interface OrbFace {
  readonly mood: OrbMood;
  readonly badge: OrbBadge | undefined;
}

/**
 * The tool names the console voice's two hosts send, by what the tool does. GPT-Live's are `TALK_TOOLS`
 * (`./talkToolsList.ts`); a Codex plan call sends the same names for its dynamic tools, plus `web search` and
 * `a command` for its own items (`./talkPlanProtocolTurns.ts`, `itemStepOf`).
 */
const TOOL_MOODS: ReadonlyMap<string, WorkMood> = new Map<string, WorkMood>([
  ["read_screen", "looking"],
  ["focus_screen", "looking"],
  ["offer_copy", "writing"],
  // A voice edit rewrites the parked draft's words on the open card, so all three wear the writing face.
  ["draft_edit_start", "writing"],
  ["draft_edit", "writing"],
  ["draft_restore", "writing"],
  ["read_page", "looking"],
  ["slack_thread_after", "slack"],
  ["slack_unread", "slack"],
  ["slack_channel", "slack"],
  ["slack_open", "slack"],
  ["code_find", "code"],
  ["code_read", "code"],
  ["code_list", "code"],
  ["file_read", "code"],
  ["file_list", "code"],
  ["a command", "code"],
  ["action_items", "recalling"],
  ["read_card", "recalling"],
  ["board_row", "recalling"],
  ["read_supervisor", "recalling"],
  ["glossary", "recalling"],
  ["origin", "recalling"],
  ["knowledge", "recalling"],
  ["supervisor_history", "recalling"],
  ["recall", "recalling"],
  ["recall_open", "recalling"],
  ["recent_steers", "recalling"],
  ["running_list", "recalling"],
  ["web search", "recalling"],
  ["browser", "browsing"],
  ["browser_open", "browsing"],
  ["open_card", "browsing"],
  // The next triage card opens as `open_card` does; ending the pass only reads back what it came to.
  ["triage_next", "browsing"],
  ["triage_end", "recalling"],
  ["triage_clock", "working"],
  ["relay_steer", "relaying"],
  ["set_stage_setting", "working"],
  ["focus_set", "working"],
  ["focus_end", "working"],
  ["focus_quiet", "working"],
  ["meeting_skip", "working"],
]);

/**
 * What a tool does, as a mood. A name off the table that still says Slack or browser — an MCP tool a Codex thread
 * reached for — is read by that word; anything else is plain work.
 *
 * @param name the tool's name as the step carries it
 * @returns the mood its badge wears
 */
export function toolMoodOf({ name }: { name: string }): WorkMood {
  const known = TOOL_MOODS.get(name);
  if (known !== undefined) {
    return known;
  }
  const lower = name.toLowerCase();
  if (lower.includes("slack")) {
    return "slack";
  }
  if (lower.includes("browser")) {
    return "browsing";
  }
  return "working";
}

/**
 * What a step of work looks like on the orb.
 *
 * @param step the focus row's step; none for a hand-off nothing has picked up, or a continue the page asked for
 * @returns thinking for reasoning, writing for writing, the tool's own mood for a tool, else working — compacting
 *   included, whose headline says what it is (`./voiceActivityStatus.ts`) so it needs no face of its own
 */
export function stepMoodOf({ step }: { step: WorkStep | undefined }): WorkMood {
  if (step === undefined) {
    return "working";
  }
  if (step.kind === "tool") {
    return toolMoodOf({ name: step.name });
  }
  if (step.kind === "reasoning") {
    return "thinking";
  }
  if (step.kind === "writing") {
    return "writing";
  }
  return "working";
}

/**
 * The face for a phase and the work in flight.
 *
 * @param phase what `voiceStatusOf` decided
 * @param focus the step of the newest in-flight row — the one the status's own detail names — or none
 * @param busy whether anything is in flight at all, since a hand-off row names no step and is still work
 * @returns the mood, and the badge the work in flight puts on it
 */
export function orbFaceOf({
  phase,
  focus,
  busy,
}: {
  phase: VoicePhase;
  focus: WorkStep | undefined;
  busy: boolean;
}): OrbFace {
  let work: WorkMood | undefined;
  if (busy) {
    work = stepMoodOf({ step: focus });
  }
  switch (phase) {
    case "off":
    case "connecting":
    case "reconnecting":
      return { badge: undefined, mood: phase };
    case "error":
    case "stalled":
      return { badge: phase, mood: phase };
    case "listening":
      return { badge: work, mood: "idle" };
    case "hearing":
    case "yielded":
    case "speaking":
      return { badge: work, mood: phase };
    case "working":
      return { badge: stepMoodOf({ step: focus }), mood: stepMoodOf({ step: focus }) };
    default: {
      const unreachable: never = phase;
      return unreachable;
    }
  }
}

/** What each mood is called where a word is wanted — the badge's hover, and the pill while previewing. */
export const MOOD_WORDS: Readonly<Record<OrbMood, string>> = {
  browsing: "in your browser",
  code: "reading the code",
  connecting: "connecting",
  error: "error",
  hearing: "hearing you",
  idle: "listening",
  looking: "looking at your screen",
  off: "talk",
  recalling: "remembering",
  reconnecting: "reconnecting",
  relaying: "relaying to the supervisor",
  slack: "reading Slack",
  speaking: "speaking",
  stalled: "no update",
  thinking: "thinking",
  working: "working",
  writing: "writing",
  yielded: "your turn",
};

/** The query parameter that draws one face with no call up: `?orb=looking`, or `?orb=speaking,slack` for a badge. */
export const ORB_PREVIEW_PARAM = "orb";

/**
 * The face a `?orb=` preview asks for, so each one can be seen — and photographed — without a live call. The first
 * name is the mood; a second, after a comma, is the badge. A mood that is itself work wears its own badge, as it
 * would live. Anything it does not name exactly draws nothing, so a typo shows the real orb rather than a guess.
 *
 * @param search the page's `location.search`
 * @returns the face to draw, or `undefined` when there is no preview or it names no mood
 */
export function orbPreviewOf({ search }: { search: string }): OrbFace | undefined {
  const asked = new URLSearchParams(search).get(ORB_PREVIEW_PARAM);
  if (asked === null) {
    return undefined;
  }
  const names = asked.split(",");
  const moodName = names.at(0);
  const badgeName = names.at(1);
  const mood = ORB_MOODS.find((known) => known === moodName);
  if (mood === undefined || names.length > 2) {
    return undefined;
  }
  if (badgeName !== undefined) {
    const badge = ORB_BADGES.find((known) => known === badgeName);
    if (badge === undefined) {
      return undefined;
    }
    return { badge, mood };
  }
  return { badge: ORB_BADGES.find((known) => known === mood), mood };
}

/**
 * The status a preview's pill shows: the phase that mood is drawn under live, and the mood's own words, so the
 * pill's colour, border and glyph are the ones a real call would give it.
 *
 * @param face the previewed face
 * @returns a status naming the preview, with no age and no nudge
 */
export function previewStatusOf({ face }: { face: OrbFace }): VoiceStatus {
  let asked: string = face.mood;
  if (face.badge !== undefined && face.badge !== face.mood) {
    asked = `${face.mood},${face.badge}`;
  }
  const detail = `preview: ?${ORB_PREVIEW_PARAM}=${asked}`;
  return {
    detail,
    headline: MOOD_WORDS[face.mood],
    nudge: undefined,
    phase: phaseOfMood({ mood: face.mood }),
    seconds: undefined,
  };
}

/** The phase `voiceStatusOf` draws a mood under. */
function phaseOfMood({ mood }: { mood: OrbMood }): VoicePhase {
  switch (mood) {
    case "off":
    case "connecting":
    case "reconnecting":
    case "hearing":
    case "yielded":
    case "speaking":
    case "stalled":
    case "error":
      return mood;
    case "idle":
      return "listening";
    case "thinking":
    case "writing":
    case "looking":
    case "slack":
    case "code":
    case "recalling":
    case "browsing":
    case "relaying":
    case "working":
      return "working";
    default: {
      const unreachable: never = mood;
      return unreachable;
    }
  }
}

/**
 * The chatgpt.com voices a call on the owner's ChatGPT plan speaks in, and the one the picker starts on.
 *
 * A mirror of `src/talk/planVoices.ts`, because `site/` cannot import `src/`. The two are held to the same members
 * in the same order by `site/__tests__/unit/talkVoices.test.ts`, and the verb refuses a name outside its own list at
 * mint time, so a drift is a failed test or a stated refusal — never a picker offering a voice the call cannot be
 * minted with.
 */

/** Every plan voice, in Codex's own order. The owner's pick in Codex CLI's `/voice` is `sol`. */
export const TALK_PLAN_VOICES: readonly string[] = [
  "juniper",
  "maple",
  "spruce",
  "ember",
  "vale",
  "breeze",
  "arbor",
  "sol",
];

/** Where the plan picker starts. The same value as `src/talk/planVoices.ts`. */
export const DEFAULT_TALK_PLAN_VOICE = "sol";

/** The browser storage key the owner's plan voice is kept under between visits. */
export const TALK_PLAN_VOICE_STORAGE_KEY = "slopweaver.talk.planVoice";

/**
 * Whether a stored or typed name is a plan voice.
 *
 * @param name the candidate
 * @returns whether a plan call may be minted in it
 */
export function isTalkPlanVoice({ name }: { name: string }): boolean {
  return TALK_PLAN_VOICES.includes(name);
}

/**
 * Whether a value read back from storage is a plan voice — a guard, so `usePreference`'s read is one stable
 * function.
 *
 * @param value what storage held
 * @returns whether a plan call may be minted in it
 */
export function isStoredTalkPlanVoice(value: unknown): value is string {
  return typeof value === "string" && isTalkPlanVoice({ name: value });
}

/**
 * Whether the settings offer a restart: a call is running in one voice and the owner has picked another. The voice is fixed
 * when a call is minted and nothing changes it mid-call, so a new pick only takes effect on the next call — so the
 * owner is told so, with a button to restart.
 *
 * @param active the voice the running call was minted in, or `undefined` with no call
 * @param selected the voice the owner has picked now
 * @param callActive whether a call is live or connecting
 * @returns whether to show the restart notice and button
 */
export function planVoiceNeedsRestart({
  active,
  selected,
  callActive,
}: {
  active: string | undefined;
  selected: string;
  callActive: boolean;
}): boolean {
  return callActive && active !== undefined && active !== selected;
}

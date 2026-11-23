/**
 * The voices a Talk call may answer in — the chatgpt.com voices, with no imports at all.
 *
 * Every call rides the owner's ChatGPT plan through `codex app-server` (`./planSession.ts`), and the realtime v3
 * session takes these names. These are the eight Codex CLI 0.157.1's `/voice` offers, which the owner picks from.
 * `thread/realtime/listVoices` on that CLI also answers `cove` for v1; `/voice` does not offer it, so neither does the
 * console.
 *
 * Import-free because `site/lib/talkVoices.ts` mirrors it, and the console builds without this repository's
 * dependencies.
 */

/** Every chatgpt.com voice a plan call may answer in, in `/voice`'s own order. */
export const TALK_PLAN_VOICE_NAMES = ["juniper", "maple", "spruce", "ember", "vale", "breeze", "arbor", "sol"] as const;

/** One chatgpt.com voice. */
export type PlanVoice = (typeof TALK_PLAN_VOICE_NAMES)[number];

/** The voice a plan call starts in: the one the owner set in `/voice`. */
export const DEFAULT_TALK_PLAN_VOICE: PlanVoice = "sol";

/**
 * Whether a name is one of the chatgpt.com voices a plan call can be minted with.
 *
 * @param name the name to check
 * @returns whether it is a plan voice
 */
export function isPlanVoice(name: string): name is PlanVoice {
  return (TALK_PLAN_VOICE_NAMES as readonly string[]).includes(name);
}

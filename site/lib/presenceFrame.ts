/**
 * How often the orb's canvas paints: every display frame while anything on it is live, at most
 * {@link PRESENCE_REST_FPS} times a second while it is at rest.
 *
 * MEASURED on a 16 GB M1 Pro whose built-in display runs at 120 Hz, the installed desktop app open
 * on the Queue with no call: the voice overlay's renderer held 13.5–23.3% of a core and the GPU process 22–40%,
 * every five seconds for a minute, because the corner orb repainted its canvas through an SVG colour filter on
 * every one of 120 frames a second while it sat still. Reproduce: `ps -o pid,command` the app's helpers, take the
 * one whose arguments carry `--slopweaver-role=overlay`, then
 * `top -l 13 -s 5 -pid <overlay> -pid <gpu> -stats pid,cpu,mem,command`.
 *
 * At rest means the mood is `off` (no call) or `idle` (the listening cloud) AND the eased level is no louder than
 * {@link PRESENCE_REST_LEVEL_EPSILON}. Both moods drift slowly, so 30 paints a second loses nothing the eye
 * follows, and the presence's clock is stepped by the time between PAINTS, so it moves at the same speed. That
 * holds only while a resting gap stays inside {@link PRESENCE_MAX_STEP_MS}, the loop's cap on one step, so the gate
 * paints a frame within {@link PRESENCE_REST_SLACK_MS} of the interval: without it a 60 Hz display's second frame
 * (about 33.32 ms, a hair under 1000 / 30) was skipped and the third, at about 50 ms, met the cap, so a jittered
 * gap was stepped short and the drift slowed. With it, any display at 60 Hz or faster rests with a gap under the
 * cap (`presenceFrame.test.ts` asserts the bound); a display slower than that already had frames the cap cut. Every
 * other mood — connecting and reconnecting have their own quicker paces, a yield beats on wall time, and every
 * work mood has its own formation — paints at the display's rate, and so does any mood a later change adds:
 * rest is an allowlist, never the default.
 */
import type { OrbMood } from "./orbMood";

/** The most paints a second an orb at rest makes. */
export const PRESENCE_REST_FPS = 30;

/** The eased level at or under which a resting mood is still at rest: the follower's tail, not a voice. */
export const PRESENCE_REST_LEVEL_EPSILON = 0.01;

/** How far short of the rest interval a frame may fall and still paint: rAF timestamps jitter around a frame. */
export const PRESENCE_REST_SLACK_MS = 2;

/** The longest frame the loop steps, so a window back from the background never leaps. */
export const PRESENCE_MAX_STEP_MS = 50;

/** The moods that may rest. */
const RESTING_MOODS: ReadonlySet<OrbMood> = new Set<OrbMood>(["off", "idle"]);

/**
 * The fewest milliseconds between two paints of an orb at rest.
 *
 * @returns `1000 / PRESENCE_REST_FPS`
 */
export function presenceRestIntervalMs(): number {
  return 1000 / PRESENCE_REST_FPS;
}

/**
 * Whether the orb's canvas paints on this display frame.
 *
 * @param elapsedMs time since the canvas last painted
 * @param level the louder of the eased lighting and swelling levels as last painted, 0…1
 * @param mood the mood the orb wears on this frame
 * @returns true when this frame paints
 */
export function shouldPaintPresenceFrame({
  elapsedMs,
  level,
  mood,
}: {
  elapsedMs: number;
  level: number;
  mood: OrbMood;
}): boolean {
  if (!RESTING_MOODS.has(mood) || level > PRESENCE_REST_LEVEL_EPSILON) {
    return true;
  }
  return elapsedMs + PRESENCE_REST_SLACK_MS >= presenceRestIntervalMs();
}

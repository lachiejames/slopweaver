/**
 * THE CHAIR'S CONTEXT REMINDER — a nudge to hand off once the supervisor chair's context is around half full.
 *
 * ## The owner's ruling, and why this is not a sixth hand-off reason
 *
 * The chair gets a reminder to hand off when its context is around half full — **soft only, a nudge in tick output, never a
 * hard stop**. `./chairCadence.ts`'s five reasons are stronger than that: any one of them turns the verdict into
 * `hand-off`, and `supervisor tick close` then prints the hand-off IN PLACE of the sweep prompt
 * (`./chairHandOffPrompt.ts`). So context fill is judged HERE, beside the cadence and never inside it: a reminder
 * prints a line, and the verdict, the close prompt and the re-armed sweep are exactly what they would have been
 * without it. The same shape as the ruling that took the 600k block away (`../sessions/sessionDepthAwareness.ts`):
 * the agent lacking awareness is the problem, so it is told.
 *
 * ## What "full" means on this install
 *
 * A session's context is full where Claude Code compacts it, and that is the `autoCompactWindow` user setting
 * (`docs/hooks/session-guards.md` § The auto-compact window — 300000 on this install), not the model's nominal
 * window: past that line the chair is compacted, lossily, rather than allowed to fill. Depth is the newest turn's
 * prompt size, read the way `session depth` reads it (`../sessions/tokenDepth.ts`). An install with no
 * `autoCompactWindow` reads the window UNMEASURED and decides nothing — the model's own window is not in any file
 * this reads, and a guessed denominator would put a confident percentage on a number nobody measured. The file is
 * the setting NOW, and a changed one applies only from the next session start, so a session whose settings file
 * changed after it booted reads UNMEASURED too ({@link windowAtBoot}): the file may no longer name the window that
 * session runs.
 *
 * **The residue, stated rather than discovered.** The window a running process booted with is in no file, so this
 * is best evidence, not proof: a change that moves no timestamp of `settings.json` or its link — the whole
 * `~/.claude` swapped under a running chair, say — goes unseen, and the reminder then prints a wrong percentage.
 * That is affordable precisely because the ruling is soft only: a wrong reminder costs one line, and no verdict,
 * close prompt or sweep ever depends on it.
 *
 * Pure: readings in, reminders and notes out. `./chairCadenceRead.ts` reads; this judges and renders.
 */
import { renderDepth } from "../sessions/sessionDepthAwareness.js";

/**
 * The share of the window at which the reminder fires — the owner's "around half full", as the number it is.
 *
 * A policy number from the ruling, not a measurement: a hand-off at half leaves the successor's pickup room and
 * keeps the chair off the lossy compaction at the window itself.
 */
export const CONTEXT_REMINDER_FRACTION = 0.5;

/** One chair session's context fill, or why it could not be read. */
export type ChairContextReading =
  | { readonly kind: "measured"; readonly depthTokens: number; readonly windowTokens: number }
  | { readonly kind: "unmeasured"; readonly why: string };

/** What the context judgement says about the chair's sessions. */
export interface ChairContextJudgement {
  /** Each reminder line, unprefixed — one per session at or past the fraction. */
  readonly reminders: readonly string[];
  /** Each session whose fill could not be read, and why. */
  readonly notes: readonly string[];
}

/**
 * The window one session runs, when the settings file can still say so: only a file last changed at or before the
 * session's boot names the window that session read when it started.
 *
 * @param windowTokens the `autoCompactWindow` the settings file names now
 * @param settingsChangedAtMs the settings file's modification instant, epoch milliseconds
 * @param bootedAtMs the session's start off Claude Code's session registry; zero where the registry records none
 * @returns the window in tokens, or why the file no longer says which window this session runs
 */
export function windowAtBoot({
  windowTokens,
  settingsChangedAtMs,
  bootedAtMs,
}: {
  windowTokens: number;
  settingsChangedAtMs: number;
  bootedAtMs: number;
}): { readonly windowTokens: number } | { readonly why: string } {
  // `JSON.parse` reads `1e309` as Infinity, which the registry parser accepts as a number.
  if (!Number.isFinite(bootedAtMs) || bootedAtMs <= 0) {
    return { why: "the Claude session registry records no boot instant, so which window it booted with is unknown" };
  }
  if (!Number.isFinite(settingsChangedAtMs) || settingsChangedAtMs > bootedAtMs) {
    return {
      why: "Claude Code's settings changed after this session booted, so the window it runs may not be the one the file now names",
    };
  }
  return { windowTokens };
}

/**
 * Judge every chair session's context fill against {@link CONTEXT_REMINDER_FRACTION}.
 *
 * @param sessionIds the chair's sessions, in the chair read's order
 * @param readings each session's fill, by session id; a session absent from it reads UNMEASURED
 * @returns the reminders and the notes, both possibly empty
 */
export function judgeChairContext({
  sessionIds,
  readings,
}: {
  sessionIds: readonly string[];
  readings: ReadonlyMap<string, ChairContextReading>;
}): ChairContextJudgement {
  const reminders: string[] = [];
  const notes: string[] = [];
  // Two live processes resuming one session id share one transcript, so they are one finding, never two.
  for (const sessionId of new Set(sessionIds)) {
    const reading = readings.get(sessionId);
    if (reading === undefined) {
      notes.push(`session ${sessionId}: its context fill is UNMEASURED — its transcript was not read`);
      continue;
    }
    if (reading.kind === "unmeasured") {
      notes.push(`session ${sessionId}: its context fill is UNMEASURED — ${reading.why}`);
      continue;
    }
    if (reading.depthTokens >= reading.windowTokens * CONTEXT_REMINDER_FRACTION) {
      reminders.push(reminderLine({ reading, sessionId }));
    }
  }
  return { notes, reminders };
}

/**
 * One reminder, as the tick prints it.
 *
 * @param sessionId the chair session past the fraction
 * @param reading its measured fill
 * @returns one line, unprefixed
 */
function reminderLine({
  sessionId,
  reading,
}: {
  sessionId: string;
  reading: Extract<ChairContextReading, { kind: "measured" }>;
}): string {
  const pct = Math.round((reading.depthTokens / reading.windowTokens) * 100);
  return (
    `REMINDER — session ${sessionId} carries ${renderDepth({ depthTokens: reading.depthTokens })} of its ` +
    `${renderDepth({ depthTokens: reading.windowTokens })} auto-compact window (${String(pct)}%), around half full: ` +
    "hand off at the next natural break. Nothing is blocked and the sweep re-arms as normal."
  );
}

/**
 * Read `autoCompactWindow` out of Claude Code's user settings text.
 *
 * @param text the settings file's contents
 * @returns the window in tokens, or why the text names none
 */
export function parseAutoCompactWindow({
  text,
}: {
  text: string;
}): { readonly windowTokens: number } | { readonly why: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    return { why: `Claude Code's settings file is not JSON (${String(error)})` };
  }
  // An OWN property only: an inherited one is not a value the settings file wrote.
  if (typeof parsed !== "object" || parsed === null || !Object.hasOwn(parsed, "autoCompactWindow")) {
    return {
      why: "Claude Code's settings name no `autoCompactWindow`, so the window is the model's own, which no file here records",
    };
  }
  const value: unknown = Reflect.get(parsed, "autoCompactWindow");
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return { why: `Claude Code's \`autoCompactWindow\` is not a positive integer (${String(value)})` };
  }
  return { windowTokens: value };
}

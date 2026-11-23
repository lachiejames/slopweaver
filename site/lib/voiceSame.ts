/**
 * Whether two reads of the voice's fold draw the same thing, so the clock in
 * `components/voice/useVoiceActivity.ts` — twelve reads a second — costs a render only when something on screen
 * changed. Beside the fold (`./voiceActivity.ts`) rather than in it, which is a file at its size cap.
 */
import type { WorkStep } from "./responsesStep";
import type { ActivityRow, VoiceStatus } from "./voiceActivity";

/**
 * Whether two statuses draw the same orb, so a clock re-reading an unchanged one costs no render.
 *
 * @returns true when every field matches
 */
export function sameStatus({ a, b }: { a: VoiceStatus; b: VoiceStatus }): boolean {
  return (
    a.phase === b.phase &&
    a.headline === b.headline &&
    a.detail === b.detail &&
    a.seconds === b.seconds &&
    a.nudge === b.nudge
  );
}

/**
 * Whether two in-flight lists draw the same rows, so an unchanged one costs no render. The step counts, since the
 * orb's face reads it (`./orbMood.ts`).
 *
 * @returns true when every row matches its counterpart field for field
 */
export function sameRows({ a, b }: { a: readonly ActivityRow[]; b: readonly ActivityRow[] }): boolean {
  return (
    a.length === b.length &&
    a.every((row, index) => {
      const other = b.at(index);
      return (
        other !== undefined &&
        row.key === other.key &&
        sameStep({ a: row.step, b: other.step }) &&
        row.words === other.words &&
        row.seconds === other.seconds &&
        row.stale === other.stale
      );
    })
  );
}

/** Whether two rows name the same step: the same kind, and for a tool the same tool. */
function sameStep({ a, b }: { a: WorkStep | undefined; b: WorkStep | undefined }): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  if (a.kind === "tool" && b.kind === "tool") {
    return a.name === b.name;
  }
  return a.kind === b.kind;
}

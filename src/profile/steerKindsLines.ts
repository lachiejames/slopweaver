/**
 * `slopweaver profile steers` as plain text: one line per kind, then what was not read. The reading itself is
 * `steerKinds.ts`'s; this only says it.
 */
import type { SteerKindsReading } from "./steerKinds.js";

/** Milliseconds in a day. */
const DAY_MS = 86_400_000;

/**
 * Whole days from one instant to another — "nothing observed for N days" asserts no threshold, only a span
 * (no arbitrary cutoff: say what is known).
 *
 * @param sinceIso the last observation
 * @param nowIso the instant read at
 * @returns the whole days between, never negative
 */
export function quietDays({ sinceIso, nowIso }: { sinceIso: string; nowIso: string }): number {
  return Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(sinceIso)) / DAY_MS));
}

/**
 * The plain-text reading: one line per kind, then what was not read.
 *
 * @returns the lines to print
 */
export function steerKindsLines({ reading }: { reading: SteerKindsReading }): readonly string[] {
  const lines = [
    `Slack steers since ${reading.sinceIso.slice(0, 10)} · ${String(reading.read)} turn(s) read · ${String(reading.unread)} cued turn(s) not yet read`,
  ];
  for (const trail of reading.kinds) {
    const corrections = trail.points.filter((point) => point.says === "corrects").length;
    const head = `${trail.title.padEnd(26)} ${String(corrections).padStart(3)}`;
    if (trail.lastCorrectedIso === undefined) {
      lines.push(head);
      continue;
    }
    const quiet = quietDays({ nowIso: reading.observedAtIso, sinceIso: trail.lastCorrectedIso });
    const line = `${head} · last ${trail.lastCorrectedIso.slice(0, 10)} · nothing observed for ${String(quiet)} day(s)`;
    if (trail.stoppedIso === undefined) {
      lines.push(line);
      continue;
    }
    lines.push(`${line} · the owner said it stopped ${trail.stoppedIso.slice(0, 10)}`);
  }
  if (reading.unparsed.length > 0) {
    lines.push(`journal line(s) that would not read: ${reading.unparsed.join(", ")}`);
  }
  return [
    ...lines,
    ...reading.gaps.map((gap) => `not read: ${gap}`),
    ...reading.residue.map((limit) => `not seen: ${limit}`),
  ];
}

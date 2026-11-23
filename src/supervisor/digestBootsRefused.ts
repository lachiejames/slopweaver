/**
 * The tick-open digest's BOOTS REFUSED line: the plans register did not read on this tick's `claude-plan-unusable`
 * pass, so every new Claude seat refuses to boot.
 *
 * The courier's wake (`../talk/bootRefusalWakeShell.ts`) is the fast path, typed into the chair within seconds of the
 * card. This is its backstop, for a chair whose courier is not following or died between its claim and its keystroke:
 * the next tick reads the same fault off its own reading and leads its decisions with it. MEASURED when the store fell
 * behind: the tick had captured that reading's document every pass and no line rendered it, so a chair that read every digest line
 * still never learned that no seat could start (`../transcripts/bootRefusalWake.ts` carries the timeline).
 *
 * Silent on a register that reads. A document that does not parse, or carries no `claude-plan-unusable` reading, is
 * UNKNOWN, never silence: a backstop that goes quiet when its input breaks is the gap it exists to close.
 *
 * Pure — documents in, lines out.
 */
import { arrayField, type DigestInputs, jsonOf, named, stringField } from "./digestRead.js";

/** The reading the tick captures the fired `claude-plan-unusable` pass as (`./scratch/fleetReadings.ts`). */
const READING = "claude-plans";

/** What every line opens with. */
const LABEL = "boots refused";

/**
 * The BOOTS REFUSED line when this tick's pass found the plans register unreadable.
 *
 * @param inputs the tick's readings, whose `claude-plans` document is `monitor check --json`
 * @returns one line when every boot refuses or the reading cannot say, none when the register read
 */
export function bootsRefusedLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const read = jsonOf({ inputs, name: READING });
  if ("line" in read) {
    return [`${LABEL}: UNKNOWN — ${read.line}`];
  }
  const reading = arrayField({ key: "readings", value: read.value }).find(
    (one) => stringField({ key: "monitorId", value: one }) === "claude-plan-unusable",
  );
  if (reading === undefined) {
    return [`${LABEL}: UNKNOWN — the ${READING} pass returned no claude-plan-unusable reading`];
  }
  const fault = arrayField({ key: "subjects", value: reading }).find(
    (one) => stringField({ key: "claudeRegisterFault", value: one }) !== undefined,
  );
  if (fault === undefined) {
    return [];
  }
  return [
    `BOOTS REFUSED — every new Claude seat refuses to boot: ${named({ key: "label", value: fault })} ` +
      `(${named({ key: "claudeRegisterFault", value: fault })}, card key ${named({ key: "key", value: fault })}). ` +
      "Say in one line that no new sessions can launch right now, then follow skills/supervisor/reference/boots-refused.md: " +
      "seat ONE investigator under the hatch only when the store is refused as stale, and never a blind `store push`.",
  ];
}

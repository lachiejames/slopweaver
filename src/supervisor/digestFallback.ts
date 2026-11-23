/**
 * Which completed JSON readings a tick's digest could only read as TEXT — said out loud by `supervisor tick open`,
 * never left for `tick close` to refuse.
 *
 * MEASURED: `session close-done --json` once printed `steer-at-risk  FIRING over 1` ahead of its document,
 * the digest read `close-done.json` as text — its only trace one `close-done: captured as text, not JSON` line in
 * the middle of the digest (`./digestRead.ts`'s `jsonOf`), naming neither why nor the cost — and `tick close` then
 * refused the whole tick until the chair hand-copied the JSON. These lines sit directly under tick open's header, on
 * stdout AND stderr, with the parse error and the verb that wrote the stray bytes. The stray line is fixed at its source (`../cli/commands/monitor/deps.ts`'s
 * `hostedPassDeps`); this is the alarm for the next verb that puts one there. It never repairs the reading — a
 * document is read whole or not at all (`../cli/commands/supervisor/tickRun.ts`), and scraping for the first `{`
 * would hide exactly the defect worth seeing.
 *
 * Pure: the capture's outcomes and the digested map in, lines out.
 */
import type { DigestReading } from "./digestRead.js";
import type { ReadingOutcome } from "./scratch/tickCapture.js";

/**
 * One line per reading that completed, wrote a non-empty `.json` file, and was digested as text because the file
 * would not parse — in capture order, naming the file and why it would not parse.
 *
 * @param readings what the capture left, in the order the readings ran
 * @param digested the same readings as the digest reads them, by name
 * @returns the lines, empty when every completed JSON reading parsed
 */
export function jsonFellBackToTextLines({
  readings,
  digested,
}: {
  readings: readonly ReadingOutcome[];
  digested: ReadonlyMap<string, DigestReading>;
}): readonly string[] {
  // Two readings CAN share a file — `bumpDriveReadingName` flattens `a-b/c` and `a/b-c` alike. The readings run in
  // order and the digest keeps the LAST one under a name, so a shared file is judged once, by its last reading, in
  // the place its first reading ran.
  const lastByFile = new Map<string, ReadingOutcome>();
  for (const reading of readings) {
    lastByFile.set(reading.file, reading);
  }
  const lines: string[] = [];
  for (const reading of lastByFile.values()) {
    // An EMPTY completed reading is a verb's error path printing nothing, which the draft already leaves out
    // (`./scratch/tickCapture.ts`'s `tickDraftArgs`) — not stray bytes ahead of a document.
    if (!reading.completed || reading.bytes === 0 || !reading.file.endsWith(".json")) {
      continue;
    }
    const read = digested.get(reading.name);
    if (read?.kind !== "text") {
      continue;
    }
    // Every verb that could have written a shared file is named, rather than a guess at which one did.
    const writers = readings
      .filter((other) => other.file === reading.file)
      .map((other) => `\`slopweaver ${other.argv.join(" ")}\``)
      .join(" or ");
    lines.push(
      `${reading.file} is NOT one JSON document, so the digest reads it as text — ${read.text}. ` +
        `Something wrote to ${writers}'s stdout besides its document; ` +
        "the tick draft refuses a document of the wrong shape, so this reading stops the tick until it parses.",
    );
  }
  return lines;
}

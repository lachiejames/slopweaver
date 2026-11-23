/**
 * The effectful half of `../../../supervisor/digestFallback.ts`: `tick open` saying, on both channels and ahead of
 * the digest, every JSON reading the digest could only read as text — the reading a tick stops on, which otherwise
 * is one buried digest line.
 */
import { jsonFellBackToTextLines } from "../../../supervisor/digestFallback.js";
import type { DigestReading } from "../../../supervisor/digestRead.js";
import type { ReadingOutcome } from "../../../supervisor/scratch/tickCapture.js";
import type { SupervisorTickDeps } from "./tickDeps.js";

/**
 * Print every fallback LOUDLY: indented under tick open's header on stdout, and named on stderr.
 *
 * @param deps the tick's seams, whose scratch channels carry the lines
 * @param digested the readings as the digest reads them, by name
 * @param readings what the capture left, in the order the readings ran
 */
export function sayJsonFallbacks({
  deps,
  digested,
  readings,
}: {
  deps: SupervisorTickDeps;
  digested: ReadonlyMap<string, DigestReading>;
  readings: readonly ReadingOutcome[];
}): void {
  for (const line of jsonFellBackToTextLines({ digested, readings })) {
    deps.scratch.writeOut(`  FELL BACK TO TEXT: ${line}`);
    deps.scratch.writeDiagnostic(`supervisor tick open: ${line}`);
  }
}

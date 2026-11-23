/**
 * Reading the clock a published atlas generation carries, off its manifest alone.
 *
 * Two readers judge an atlas on this exact value — `atlas freshness`, which reports the estate, and the
 * scheduled resync (`live/resync/clock.ts`), which judges an attempt on whether this clock MOVED — so it
 * lives once, here, where a second copy of the read cannot disagree with the sweep that reports it. Writing
 * the clock is `./manifestClock.ts`'s job; this module only reads it.
 */
import { isRecord } from "../../lib/parsers.js";
import { safeJsonParse } from "../../lib/safeJson.js";
import { readFileIfPresent } from "../atlasFile.js";

/**
 * The generation clock one manifest carries, without reading a single kind file.
 *
 * An absent manifest is `null` — the never-published case, which the judge already treats as behind at any
 * window. A manifest that is present and unreadable is `null` too, and that is deliberate rather than
 * sloppy: the judge's own unreadable-clock branch is what reports it, and a sweep that threw on one corrupt
 * atlas would stop judging the other thirty-five.
 *
 * @param manifestPath the manifest to read
 * @returns the `updatedAt` it declares, or `null` when there is none to read
 */
export function generationClock({ manifestPath }: { manifestPath: string }): string | null {
  const raw = readFileIfPresent({ path: manifestPath });
  if (raw.isErr() || raw.value === null) {
    return null;
  }
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: manifestPath, text: raw.value });
  } catch {
    return null;
  }
  if (!isRecord(decoded)) {
    return null;
  }
  const updatedAt = decoded["updatedAt"];
  return typeof updatedAt === "string" ? updatedAt : null;
}

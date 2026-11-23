/**
 * The one constructor for an exact-name row of the state-home classification.
 *
 * The tables in `./authoredDirectories.ts`, `./authoredDirectoryRows.ts`, `./unimportedDirectoryRows.ts` and
 * `./liveClassification.ts` build every row through it, so each table stays one line per directory.
 */
import type { HomeDirectoryClass, HomeDirectoryClassification } from "./authoredDirectories.js";

/**
 * Shorthand for an exact-name row, so a classification table stays one entry per path.
 *
 * @returns the row for exactly this path, never a prefix family
 */
export function exact({
  name,
  directoryClass,
  because,
}: {
  name: string;
  directoryClass: HomeDirectoryClass;
  because: string;
}): HomeDirectoryClassification {
  return { because, directoryClass, name, prefix: false };
}

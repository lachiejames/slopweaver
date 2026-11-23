/**
 * The shared fixture the collector tests read through: one window, an in-memory filesystem, and a journal line.
 * Split out of `collect.test.ts` when the run-journal and PR-proof collectors moved into their own files, so the
 * three test files stand on one copy.
 */
import type { ReflectWindow, SubstrateReader } from "../../../reflect/substrate.js";

/** The window every collector test reads against. */
export const window: ReflectWindow = { fromIso: "2026-08-27T00:00:00.000Z", toIso: "2026-08-28T00:00:00.000Z" };

/**
 * An in-memory filesystem. A plain fake passed through the collectors' own seam — not a mock, and no test
 * here ever reads the operator's real ledgers.
 *
 * @param files every file's path and contents
 * @returns the reader seam over those files
 */
export const fakeReader = ({ files }: { files: Readonly<Record<string, string>> }): SubstrateReader => ({
  listNames: (dir) =>
    [
      ...new Set(
        Object.keys(files)
          .filter((path) => path.startsWith(`${dir}/`))
          .map((path) => path.slice(dir.length + 1).split("/")[0]!),
      ),
    ].toSorted((a, b) => a.localeCompare(b)),
  readText: (path) => files[path],
});

/**
 * One run-journal line, its `why` doubling as a question's text.
 *
 * @returns the line, as JSON
 */
export const journalLine = ({ kind, atIso, why }: { kind: string; atIso: string; why: string }): string =>
  JSON.stringify({ atIso, kind, question: why, why });

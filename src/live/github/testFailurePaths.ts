/**
 * The failing TEST FILES a CI job log names, read one line at a time.
 *
 * A landing row should say not only that CI failed on a check but which particular unit test file is failing, and
 * whether it is a test file the pull request added. A check's
 * name says which job failed; only its log says which file. This module is the part that reads the log.
 *
 * **Line by line, never over the whole log.** A job log is data-sized — a `unit` job's measured 3.2 MB in
 * `./jobLog.ts` — and the reader that streams it keeps only a bounded window. A failing file is reported
 * where the runner happens to print it, usually far from both the annotations and the tail that window
 * keeps, so extraction has to see every line AS it streams past, before the window drops it.
 *
 * **Conservative on purpose.** A path is taken only from a line a test runner marks as a FAILURE, and only
 * when it carries a test-file suffix (`.test.` or `.spec.`): Vitest's and Jest's `FAIL <path>` line, Vitest's
 * `❯ <path> (… failed)` summary line, and a runner `##[error]` annotation. A passing file named in a log is
 * never a failing one, and a guess from prose would put a file that did not fail in front of the supervisor
 * as though it had.
 *
 * Pure. No I/O.
 */

/**
 * Terminal colour sequences a runner leaves in a log, which would otherwise split `FAIL` from its path. Built
 * from the escape's code point so the source carries no control character for a linter to refuse.
 */
const ANSI_SEQUENCE = new RegExp(`${String.fromCodePoint(27)}\\[[0-9;]*m`, "gu");

/** One test file path: segments of path characters, ending in a `.test.`/`.spec.` script suffix. */
const TEST_FILE = /(?:[\w@.+-]+[\\/])*[\w@.+-]+\.(?:test|spec)\.[cm]?[jt]sx?/gu;

/** Whether a stripped line is one a test runner prints for a FAILED file or a failure annotation. */
function isFailureLine({ line }: { line: string }): boolean {
  if (line.startsWith("FAIL ") || line.startsWith("##[error]")) {
    return true;
  }
  return line.startsWith("❯ ") && /\bfailed\)/u.test(line);
}

/** One raw match as a repository-relative path: forward slashes, no leading `./`. */
function normalised({ path }: { path: string }): string {
  return path.replaceAll("\\", "/").replace(/^(?:\.\/)+/u, "");
}

/**
 * The failing test files one log line names, in the order it names them.
 *
 * @param line one log line, with or without its timestamp stripped
 * @returns every test-file path a failure line carries, deduped; empty for any other line
 */
export function testFilePathsFromLine({ line }: { line: string }): readonly string[] {
  const stripped = line.replace(ANSI_SEQUENCE, "").trim();
  if (!isFailureLine({ line: stripped })) {
    return [];
  }
  const found: string[] = [];
  for (const match of stripped.matchAll(TEST_FILE)) {
    const path = normalised({ path: match[0] });
    if (!found.includes(path)) {
      found.push(path);
    }
  }
  return found;
}

/**
 * The failing test files a SMALL text names, first-seen order, deduped — for a fixture or an annotation list.
 *
 * Never call this on a whole job log: that is a data-sized string, which `./jobLog.ts`'s accumulator exists
 * to avoid. It feeds {@link testFilePathsFromLine} one streamed line at a time instead.
 *
 * @param text a few lines of log text
 * @returns every failing test file named, each once
 */
export function testFilePathsFromText({ text }: { text: string }): readonly string[] {
  const found: string[] = [];
  for (const line of text.split("\n")) {
    for (const path of testFilePathsFromLine({ line })) {
      if (!found.includes(path)) {
        found.push(path);
      }
    }
  }
  return found;
}

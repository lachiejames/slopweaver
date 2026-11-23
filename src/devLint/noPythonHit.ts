/**
 * The no-python gate's hit shape: what one hit reports, and the one constructor every scanner builds it with.
 * A leaf — it imports nothing, so `noPython.ts` and `noPythonTypeScript.ts` both build on it without a cycle.
 */

/**
 * Which of the four shapes a hit is.
 *
 * @internal — part of {@link PythonHit}; nothing outside this gate names it.
 */
export type PythonHitKind = "python-file" | "python-shebang" | "process-call" | "instruction";

/** One place a file runs, or tells a reader to run, a Python interpreter. */
export interface PythonHit {
  readonly path: string;
  /** 1-based. */
  readonly line: number;
  /** 0-based, on that line. */
  readonly column: number;
  readonly kind: PythonHitKind;
  /** The hit's physical line, trimmed — the debt identity together with `path`. */
  readonly matchedLine: string;
}

/**
 * A hit at a line and column, with its physical line as the identity.
 *
 * @param context the file being scanned
 * @param line 0-based line
 * @param column 0-based column
 * @param kind the hit's shape
 * @returns the hit
 */
export function hitAt({
  context,
  line,
  column,
  kind,
}: {
  context: { path: string; lines: readonly string[] };
  line: number;
  column: number;
  kind: PythonHitKind;
}): PythonHit {
  return { column, kind, line: line + 1, matchedLine: context.lines[line]!.trim(), path: context.path };
}

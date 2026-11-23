/**
 * The ways `handover pause` and `handover unpause` write nothing once they hold the row's lock
 * (`../cli/commands/handover/pauseRun.ts`'s `writePauseEdit`).
 *
 * Its own small union per `.claude/rules/error-handling.md`: the lock was never had, the file could not be read or
 * written or now holds another row, the row reads malformed, the row as it reads NOW refuses the edit (paused,
 * settled or closed since the scan), or the front-matter writer refused the splice. Every variant carries `reasons`,
 * the refusal as the lines the verb prints, because the front-matter writer's own refusals are plural.
 *
 * Pure: every factory takes what it names.
 */

import type { FrontMatterError } from "./frontmatterErrors.js";

/** The row's lock was never had — another writer held it past every attempt, or the row is hard-linked or moved. */
export interface PauseEditLockError {
  readonly code: "ROW_LOCK";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The file could not be read or written, or now holds a different row. */
export interface PauseEditFileError {
  readonly code: "ROW_FILE";
  readonly message: string;
  readonly path: string;
  readonly reasons: readonly string[];
}

/** The row as it reads under the lock does not parse cleanly, so nothing may be written to it. */
export interface PauseEditMalformedError {
  readonly code: "ROW_MALFORMED";
  readonly message: string;
  readonly slug: string;
  readonly reasons: readonly string[];
}

/** The row as it reads under the lock refuses this edit — paused, settled or closed since the board scan. */
export interface PauseEditRefusedError {
  readonly code: "EDIT_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The front-matter writer refused the splice; `reasons` are its own. */
export interface PauseEditFrontMatterError {
  readonly code: "FRONT_MATTER_REFUSED";
  readonly message: string;
  readonly cause: FrontMatterError;
  readonly reasons: readonly string[];
}

/** Every way a pause or its lifting writes nothing once the verb holds the row's lock. */
export type PauseEditError =
  PauseEditLockError | PauseEditFileError | PauseEditMalformedError | PauseEditRefusedError | PauseEditFrontMatterError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const PauseEditErrors = {
  file: ({ path, detail }: { path: string; detail: string }): PauseEditFileError => {
    const message = `${path}: ${detail}`;
    return { code: "ROW_FILE", message, path, reasons: [message] };
  },
  frontMatter: ({ cause }: { cause: FrontMatterError }): PauseEditFrontMatterError => ({
    cause,
    code: "FRONT_MATTER_REFUSED",
    message: cause.message,
    reasons: cause.reasons,
  }),
  lock: ({ message }: { message: string }): PauseEditLockError => ({ code: "ROW_LOCK", message, reasons: [message] }),
  malformed: ({ slug, problem }: { slug: string; problem: string }): PauseEditMalformedError => {
    const message = `${slug} does not parse cleanly, so nothing may be written to it: ${problem}`;
    return { code: "ROW_MALFORMED", message, reasons: [message], slug };
  },
  refused: ({ why }: { why: string }): PauseEditRefusedError => ({
    code: "EDIT_REFUSED",
    message: why,
    reasons: [why],
  }),
} as const;

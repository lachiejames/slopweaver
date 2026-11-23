/**
 * Turning the TEXT of an action document into an action — and the typed refusal for every way that fails.
 *
 * ## Why this is a domain error rather than four strings in the verb
 *
 * `--action` fails in four genuinely different ways, each wanting its own sentence: the path is not there,
 * the bytes are not JSON, the document reads as nothing at all, or it parses and breaks one of
 * `./askAction.ts`'s own rules. Four sentences authored into one verb is exactly the shape
 * `error-shape-threshold` refuses past its cap, and `.claude/rules/error-handling.md`'s answer is this
 * file: one union, one factory, and a caller that displays `error.message` rather than rebuilding it.
 *
 * **The message carries its own guidance.** `FILE_UNREADABLE` names the three spellings in its own
 * sentence rather than leaving the verb to add a second line, because a caller that has to remember to
 * print the fix beside the failure is a caller that will eventually not.
 *
 * Pure: text in, an action or a typed refusal out. The FILE is read by the verb, which maps the boundary's
 * own `IngestError` into {@link AskActionInputErrors.fileUnreadable} at that exact point.
 */

import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse } from "../lib/safeJson.js";

import type { AskAction } from "./askAction.js";
import { destinationLetterProblem } from "./askActionDestination.js";
import { askActionFrom } from "./askActionWire.js";

/** `--action` named a path and the file would not read. */
export interface ActionFileUnreadableError {
  readonly code: "FILE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The document's bytes are not JSON at all. */
export interface ActionNotJsonError {
  readonly code: "NOT_JSON";
  readonly message: string;
}

/** The document parsed and carried no action — `null`, or an empty document. */
export interface ActionEmptyError {
  readonly code: "EMPTY";
  readonly message: string;
}

/** The document parsed as an action and broke one of the action's own rules. */
export interface ActionBrokenError {
  readonly code: "BROKEN";
  readonly message: string;
  /** The first rule it broke, exactly as `./askAction.ts` words it. */
  readonly why: string;
}

/** Every way an action document fails to become an action. */
export type AskActionInputError = ActionFileUnreadableError | ActionNotJsonError | ActionEmptyError | ActionBrokenError;

/** The factory the verb and its tests both build refusals through. */
export const AskActionInputErrors = {
  broken: ({ why }: { why: string }): ActionBrokenError => ({
    code: "BROKEN",
    message: `the action does not read: ${why}`,
    why,
  }),
  empty: (): ActionEmptyError => ({
    code: "EMPTY",
    message: "--action carried no action at all — it read as empty",
  }),
  fileUnreadable: ({ path, cause }: { path: string; cause: string }): ActionFileUnreadableError => ({
    code: "FILE_UNREADABLE",
    message:
      `--action named a file it could not read: ${cause}. Spell it as \`-\` to read stdin, ` +
      "as the JSON document itself, or as a path that exists",
    path,
  }),
  notJson: ({ cause }: { cause: string }): ActionNotJsonError => ({
    code: "NOT_JSON",
    message: `--action is not JSON: ${cause}`,
  }),
} as const;

/**
 * One action document, parsed and judged against its own rules.
 *
 * @param text the document's bytes, from wherever the verb read them
 * @param label how a size refusal names this read, passed straight to `../lib/safeJson.ts`
 * @returns the action, or the one way it failed
 */
export function actionFromText({
  text,
  label,
}: {
  text: string;
  label: string;
}): Result<AskAction, AskActionInputError> {
  let value: unknown;
  try {
    value = safeJsonParse({ label, text });
  } catch (error: unknown) {
    return err(AskActionInputErrors.notJson({ cause: String(error) }));
  }
  const read = askActionFrom({ value });
  if (read.kind === "action") {
    // A mail action offers one draft and no destinations, so it carries no lettered label to refuse.
    if (!("destinations" in read.action)) {
      return ok(read.action);
    }
    // A write-only rule: an action already on disk still reads (`destinationLetterProblem`).
    const lettered = read.action.destinations
      .map((destination) => destinationLetterProblem({ destination }))
      .find((problem) => problem !== undefined);
    if (lettered !== undefined) {
      return err(AskActionInputErrors.broken({ why: lettered }));
    }
    return ok(read.action);
  }
  if (read.kind === "none") {
    return err(AskActionInputErrors.empty());
  }
  return err(AskActionInputErrors.broken({ why: read.why }));
}

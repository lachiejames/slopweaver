/**
 * Decoding a gate's committed debt list, once, for every gate that keeps one.
 *
 * Three ratchet gates had written the same two sentences each — `<name>: <why the JSON would not parse>`
 * and `<name>: unexpected shape (expected <the shape>)` — and a fourth (`untested-modules`) was about to
 * add the ninth and tenth copies. `error-shape-threshold` is what noticed: `src/devLint` sat one shape
 * under its recorded ceiling, and two more took it over, which is the gate working exactly as
 * `error-handling.md` describes it. The answer it names is to stop authoring the shape, not to raise the
 * ceiling, so the two sentences are `DevLintInputErrors`' `BASELINE_MALFORMED` and `BASELINE_SHAPE_INVALID`
 * (`./errors.ts`), raised HERE and nowhere else.
 *
 * Both messages carry the caller's own label, so what a reader sees is unchanged. What changed is that a
 * fifth gate keeping a debt list adds no error shape at all. {@link readCommittedInput} is the read in front
 * of it, for the gates that each wrapped the same `readFileSync` in the same try/catch.
 */
import { readFileSync } from "node:fs";

import type { z } from "zod";
import { parseJson } from "../lib/jsonParse.js";
import { err, ok, type Result } from "../lib/result.js";
import { type CommittedInputKind, type DevLintInputError, DevLintInputErrors } from "./errors.js";

/**
 * Parse a debt list's text and decode it against the gate's own schema. Pure.
 *
 * @param label how the gate names its own list in a message, e.g. `untested-modules baseline`
 * @param schema the gate's decoder for its list
 * @param shape the accepted shape, written as a reader would type it, e.g. `{ modules: ["path", …] }`
 * @param text the committed file's contents
 * @returns the decoded list, or one sentence naming which half of the decode failed
 */
export function decodeDebtList<T>({
  label,
  schema,
  shape,
  text,
}: {
  label: string;
  schema: z.ZodType<T>;
  shape: string;
  text: string;
}): Result<T, DevLintInputError> {
  const parsed = parseJson({ text });
  if (parsed.isErr()) {
    return err(DevLintInputErrors.baselineMalformed({ detail: parsed.error.message, label }));
  }
  const decoded = schema.safeParse(parsed.value);
  if (!decoded.success) {
    return err(DevLintInputErrors.baselineShapeInvalid({ expected: shape, label }));
  }
  return ok(decoded.data);
}

/**
 * Whether no two rows of a debt list share an identity — the refinement a list keyed by identity carries, so a
 * duplicated row is a malformed list the gate refuses rather than a second allowance it quietly sums or folds,
 * which `baselineRegistry.ts` would then read as a shape error instead of a loosening.
 *
 * @param rows the decoded rows
 * @param identity the key one row is recorded under, the same parts the registry row names
 * @returns true when every identity appears once
 */
export function identitiesAreUnique<T>({
  rows,
  identity,
}: {
  rows: readonly T[];
  identity: (row: T) => string;
}): boolean {
  return new Set(rows.map((row) => identity(row))).size === rows.length;
}

/**
 * Read a gate's committed debt list or floor file, naming it by kind when it cannot be read at all.
 *
 * @param kind how the gate names the file in its failure line
 * @param path the file's absolute path
 * @returns the file's text, or why it could not be read
 */
export function readCommittedInput({
  kind,
  path,
}: {
  kind: CommittedInputKind;
  path: string;
}): Result<string, DevLintInputError> {
  try {
    return ok(readFileSync(path, "utf8"));
  } catch {
    return err(DevLintInputErrors.baselineUnreadable({ kind, path }));
  }
}

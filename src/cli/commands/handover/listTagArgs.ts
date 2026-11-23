/**
 * `handover list --tag`'s argument half: every `--tag` occurrence read into one filter BEFORE the board is scanned,
 * so a malformed term is a usage error rather than a filtered board that silently kept everything.
 *
 * `parseFlags` keeps a repeated flag's LAST value, and `collectRepeated` skips a valueless occurrence — for a filter
 * either one silently widens the result. So every raw occurrence is checked for a value first, and only then are
 * the helpers used.
 */

import { err, ok, type Result } from "#lib/result.js";

import { RowTagErrors } from "../../../handover/rowTagErrors.js";
import { EMPTY_TAG_FILTER, parseTagFilter, type TagFilter } from "../../../handover/tagFilter.js";
import { collectRepeated, withoutRepeated } from "../../optionParsers.js";

const TAG_FLAG = "--tag";

/**
 * The `--tag` filter an argv tail names, and the tail without it for the ordinary flag parser.
 *
 * @param rest the verb's argument tail
 * @returns the filter (empty when no `--tag` was passed) and the remaining tail, or every refusal
 */
export function listTagArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<{ filter: TagFilter; rest: readonly string[] }> {
  const valueless = rest.some((token, index) => {
    const next = rest[index + 1];
    return token === TAG_FLAG && (next === undefined || next.startsWith("-"));
  });
  if (valueless) {
    return err([RowTagErrors.valuelessFlag().message]);
  }
  const flagValues = collectRepeated({ name: TAG_FLAG, rest });
  const remaining = withoutRepeated({ name: TAG_FLAG, rest });
  if (flagValues.length === 0) {
    return ok({ filter: EMPTY_TAG_FILTER, rest: remaining });
  }
  return parseTagFilter({ flagValues }).map((filter) => ({ filter, rest: remaining }));
}

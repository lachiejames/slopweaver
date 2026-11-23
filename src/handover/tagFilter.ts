/**
 * The `handover list --tag` FILTER: which board rows a set of tag terms selects.
 *
 * Querying is one flag. A bare key finds rows that have it; `!key` finds rows missing it, which is how untagged work
 * shows up rather than hides. So a term is one of three shapes — `key=value`, `key`, `!key` — and every term must hold (AND). A term is judged
 * against the registry before any row is read: an unknown key or a value its key never takes is an error, never a
 * silently empty board.
 *
 * A filter matches {@link RowTags.tags} only. An UNRECOGNISED tag — journalled under a vocabulary the running build
 * refuses — is kept to be seen and never matched (`rowTagFold.ts`), so `!key` selects a row that carries only an
 * unrecognised value of that key: to the filter it does not carry one.
 *
 * Pure: no filesystem, no clock.
 */

import { err, ok, type Result } from "#lib/result.js";

import { RowTagErrors } from "./rowTagErrors.js";
import type { RowTags } from "./rowTagFold.js";
import { filterableTerm, readsJournal, TAG_LIST_SEPARATOR, type TagKeySpec } from "./rowTags.js";

/** One term of a filter, as parsed. `text` is the term as written, which is how a document reports it back. */
type TagFilterTerm =
  | { readonly kind: "has-value"; readonly key: string; readonly value: string; readonly text: string }
  | { readonly kind: "has-key"; readonly key: string; readonly text: string }
  | { readonly kind: "lacks-key"; readonly key: string; readonly text: string };

/** Every term a filter holds, in the order first written, each once. */
export interface TagFilter {
  readonly terms: readonly TagFilterTerm[];
  /** Whether some term names a key an incomplete journal can leave wrong — see {@link readsJournal}. */
  readonly readsJournal: boolean;
}

/** One term, parsed and judged against the registry, with the key's spec it named. */
function parseTerm({ text }: { text: string }): Result<{ term: TagFilterTerm; spec: TagKeySpec }, string> {
  if (text.length === 0) {
    return err(RowTagErrors.emptyTerm().message);
  }
  if (text.startsWith("!")) {
    const key = text.slice(1);
    if (key.includes("=")) {
      return err(RowTagErrors.negatedValue({ text }).message);
    }
    return judged({ key, term: { key, kind: "lacks-key", text }, value: undefined });
  }
  const at = text.indexOf("=");
  if (at < 0) {
    return judged({ key: text, term: { key: text, kind: "has-key", text }, value: undefined });
  }
  const key = text.slice(0, at);
  const value = text.slice(at + 1);
  if (key.length === 0 || value.length === 0) {
    return err(RowTagErrors.malformed({ text }).message);
  }
  return judged({ key, term: { key, kind: "has-value", text, value }, value });
}

/** A term the registry has accepted, or its refusal. */
function judged({
  key,
  value,
  term,
}: {
  key: string;
  value: string | undefined;
  term: TagFilterTerm;
}): Result<{ term: TagFilterTerm; spec: TagKeySpec }, string> {
  if (key.length === 0) {
    return err(RowTagErrors.emptyTerm().message);
  }
  return filterableTerm({ key, value })
    .map((spec) => ({ spec, term }))
    .mapErr((error) => error.message);
}

/**
 * Read every `--tag` value into one filter. Each value is a `,`-separated list of terms, so `--tag a --tag b` and
 * `--tag a,b` are the same filter. A term written twice is kept once, where it first appeared. Every refusal is
 * collected, so one run names every bad term rather than the first.
 *
 * @param flagValues each `--tag` value as written, in order
 * @returns the filter, or every term's refusal
 */
export function parseTagFilter({ flagValues }: { flagValues: readonly string[] }): Result<TagFilter> {
  const problems: string[] = [];
  const terms: TagFilterTerm[] = [];
  let journal = false;
  for (const text of flagValues.flatMap((value) => value.split(TAG_LIST_SEPARATOR))) {
    const parsed = parseTerm({ text });
    if (parsed.isErr()) {
      problems.push(parsed.error);
      continue;
    }
    journal = journal || readsJournal({ spec: parsed.value.spec });
    if (!terms.some((term) => term.text === text)) {
      terms.push(parsed.value.term);
    }
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({ readsJournal: journal, terms });
}

/** Whether a row's actionable tags satisfy one term. */
function termHolds({ term, tags }: { term: TagFilterTerm; tags: RowTags }): boolean {
  const ofKey = tags.tags.filter((tag) => tag.key === term.key);
  if (term.kind === "has-value") {
    return ofKey.some((tag) => tag.value === term.value);
  }
  return term.kind === "has-key" ? ofKey.length > 0 : ofKey.length === 0;
}

/**
 * Whether a row's tags satisfy every term of a filter. Reads {@link RowTags.tags} only, never the unrecognised ones.
 *
 * @param filter the parsed filter
 * @param tags the row's tags
 * @returns true when every term holds
 */
export function matchesTagFilter({ filter, tags }: { filter: TagFilter; tags: RowTags }): boolean {
  return filter.terms.every((term) => termHolds({ tags, term }));
}

/** The filter a whole board is read through: no terms, so every row matches. */
export const EMPTY_TAG_FILTER: TagFilter = { readsJournal: false, terms: [] };

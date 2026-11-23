/**
 * The text and attribute primitives every Linear projection is built out of — joining defined parts,
 * rendering one `Label: value` clause, folding a set-valued list, and copying only the defined entries into
 * an attrs map.
 *
 * Split out of {@link ./project.js} (the file-size ratchet, step 4). It is a LEAF on purpose: every record
 * projector reaches down into it and it reaches back into nothing, so a projection can move into its own
 * sibling later without either file importing the other.
 */
import type { CorpusAttributeValue } from "../types.js";

/**
 * Join defined string parts with a newline (drops undefined without faking an empty). Pure.
 *
 * @param parts the candidate lines, absent ones included
 * @returns the defined, non-empty parts joined by newlines
 */
export function joinDefined({ parts }: { parts: readonly (string | undefined)[] }): string {
  return parts.filter((part): part is string => part !== undefined && part.length > 0).join("\n");
}

/**
 * The container one issue belongs under. Pure.
 *
 * @param team the issue's team key, absent when the fetch could not resolve one
 * @returns `linear/<team>` when the team is known, else `linear`
 */
export function issueContainer({ team }: { team: string | undefined }): string {
  return team !== undefined && team.length > 0 ? `linear/${team}` : "linear";
}

/**
 * Copy each DEFINED entry into an attrs map, dropping absent values and empty lists.
 *
 * A table rather than thirty `if` statements, which matters at this size: the issue projection now carries
 * ~25 attributes, and the shape of the bug that hides in thirty near-identical guards is one of them silently
 * spelling a key differently from the one a reader looks for. Pure.
 *
 * @param entries key/value pairs, values possibly absent
 * @returns the attrs map holding only the defined, non-empty values
 */
export function definedAttrs({
  entries,
}: {
  entries: readonly (readonly [string, CorpusAttributeValue | undefined])[];
}): Record<string, CorpusAttributeValue> {
  const out: Record<string, CorpusAttributeValue> = {};
  for (const [key, value] of entries) {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * One `Label: value` clause, the building block of every summary line here. Pure.
 *
 * @param value the value, absent when the field was never set
 * @returns the clause, or `undefined` when there is no value to render
 */
export function labelled({ label, value }: { label: string; value: string | number | undefined }): string | undefined {
  return value === undefined ? undefined : `${label}: ${String(value)}`;
}

/**
 * Join the defined parts of a summary line with the house separator. Pure.
 *
 * @param parts the clauses, absent ones included
 * @returns the defined, non-empty clauses joined by the separator
 */
export function summaryLineOf({ parts }: { parts: readonly (string | undefined)[] }): string {
  return parts.filter((part): part is string => part !== undefined && part.length > 0).join(" · ");
}

/**
 * A set-valued list rendered into a summary line — deduped and SORTED at the projection choke-point.
 *
 * The parse edge already canonicalises what it reads off a connection, and this is deliberately a second
 * guard rather than a duplicate one. `text` participates in the dedup fingerprint, so an unsorted list reaching
 * a summary line churns bronze on every refresh forever — and the projector is the ONE place every record is
 * built, whichever parse or caller supplied the item. Ordering carries no information in any of these lists
 * (labels, teams, initiatives, projects are all sets), so there is nothing to lose by fixing it.
 *
 * @param label the summary label
 * @param values the set-valued list (absent or empty ⇒ no clause)
 * @returns the `Label: a, b` clause, or undefined
 */
export function listClause({
  label,
  values,
}: {
  label: string;
  values: readonly string[] | undefined;
}): string | undefined {
  if (values === undefined || values.length === 0) {
    return undefined;
  }
  return `${label}: ${[...new Set(values)].toSorted().join(", ")}`;
}

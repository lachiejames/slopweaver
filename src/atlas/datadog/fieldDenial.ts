/**
 * The one question `sensitiveFields.ts`'s table exists to answer: is this field, in this kind, refused?
 *
 * Kept apart from the table so the table stays data and this stays the single rule that reads it. A field no
 * row names is ADMITTED — the table is a denylist, and `sensitivity.ts` is the layer that looks at the bytes of
 * everything it admits.
 *
 * That admission is only safe for a kind the table was reviewed against. A kind it has never heard of — a
 * typo, or a string decoded from disk — would match no scoped row and so admit every scoped credential field,
 * which is why the kind is typed by the closed union and a decoded one is narrowed with
 * {@link isDatadogDenialScope} first: the sensitivity gate refuses the whole generation for one that is not.
 */
import { DATADOG_KINDS, type DatadogKind } from "./model.js";
import { DATADOG_FIELD_DENIALS, type DatadogDenialReason } from "./sensitiveFields.js";

/**
 * The scan kind the publish gate uses for the generation MANIFEST. It is deliberately not a real kind and
 * must never be added to `DATADOG_KINDS`: only the unscoped rows apply to the manifest, which is exactly the
 * check a document carrying no provider payload of its own needs.
 */
export const DATADOG_MANIFEST_SCAN_KIND = "manifest";

/** Every scope the field table can be consulted under: a published kind, or the manifest. */
export type DatadogDenialScope = DatadogKind | typeof DATADOG_MANIFEST_SCAN_KIND;

/**
 * Whether a decoded string names a scope the field table was reviewed against.
 *
 * @param value a kind as it arrived, from a caller or from disk
 * @returns true for every `DATADOG_KINDS` member and the manifest scan kind, false for anything else
 */
export function isDatadogDenialScope(value: string): value is DatadogDenialScope {
  return value === DATADOG_MANIFEST_SCAN_KIND || (DATADOG_KINDS as readonly string[]).includes(value);
}

/**
 * Why one field is refused in one kind, or `null` if it is not.
 *
 * A scoped row wins over nothing else: the table is scanned in order and the first row whose field matches
 * AND whose scope admits the kind decides. Two rows may share a field name with different reasons and
 * disjoint scopes — `token` is exactly that — so the scope test is what selects between them rather than
 * the order they happen to sit in.
 *
 * @param kind the atlas scope the document being projected belongs to, which is what makes a name secret or
 * not; closed, so a misspelled kind fails to compile instead of silently matching no scoped row
 * @param field the provider's own property name, compared exactly rather than case-folded — Datadog is
 * consistent about casing within a model, and a case-insensitive test would start matching names nobody
 * reviewed
 * @returns which refusal applied, or `null` when the field may be stored
 * @internal
 */
export function datadogFieldDenial({
  kind,
  field,
}: {
  kind: DatadogDenialScope;
  field: string;
}): DatadogDenialReason | null {
  const row = DATADOG_FIELD_DENIALS.find(
    (denial) =>
      denial.field === field &&
      (denial.kinds === null || (kind !== DATADOG_MANIFEST_SCAN_KIND && denial.kinds.includes(kind))),
  );
  if (row === undefined) {
    // The table is a denylist over a reviewed scope: no row naming this field there means it is admitted.
    return null;
  }
  return row.reason;
}

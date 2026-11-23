/**
 * The one cut every GCP door output goes through before it can print a value it must not: a secret payload, or
 * a Cloud Run template's literal env value. Google quotes request bodies and env values back in free text — a
 * failed call's detail, an operation's error, a service's terminal condition — so a field-level drop of `value`
 * is not enough on its own.
 *
 * What it closes is DATA FLOW: text that carries a value the door has read, cut wherever it is printed after
 * that read. What it does not close is COINCIDENCE with an identifier the door prints by design — an env
 * variable's own name (a value equal to `API_TOKEN` survives inside its `<env API_TOKEN>` label, since a label
 * is never rescanned), a role, a member, a resource name, a digest, a length — nor argv echoed back to the
 * caller who typed it, whether by validation before anything was read or by an uncaught exception from the
 * door's own ledger I/O quoting a `--home` path. Cutting those would mangle the identifiers a reader needs, for
 * a value that already is one; the mechanism that would close it is printing no identifiers at all.
 */
import { containersOf, envOf } from "./lists.js";
import type { RunTemplate } from "./wire.js";

/** One value that must never be printed, and what stands in for it. */
export interface UnprintableValue {
  readonly value: string;
  readonly label: string;
}

/**
 * Every literal env value a template carries, labelled by its variable's name. A secret REFERENCE carries no
 * value and is not listed.
 *
 * @returns one entry per literal env value, in template order
 */
export function literalEnvValues({ template }: { template: RunTemplate }): readonly UnprintableValue[] {
  return containersOf({ template }).flatMap((container) =>
    envOf({ container }).flatMap((entry) =>
      entry.value === undefined ? [] : [{ label: `<env ${entry.name}>`, value: entry.value }],
    ),
  );
}

/**
 * Cut every listed value out of the text. The longest is cut first, so one value containing another is cut
 * whole; a short value such as `1` is cut too, at the cost of a less readable line, because nothing here can
 * tell which value is a credential.
 *
 * @param text what is about to be printed
 * @param values what must not appear in it
 * @returns the text with each value replaced by its label
 */
export function cutValues({ text, values }: { text: string; values: readonly UnprintableValue[] }): string {
  const ordered = values
    .filter((entry) => entry.value.length > 0)
    .toSorted((left, right) => right.value.length - left.value.length);
  let safe = text;
  for (const { value, label } of ordered) {
    safe = safe.split(value).join(label);
  }
  return safe;
}

/**
 * A failure with every listed value cut out of its message, everything else kept — for an error raised AFTER such a
 * value was read, by a request that never carried it, so the transport's own cut could not know it.
 *
 * @param error the failure about to be reported
 * @param values what must not appear in its message
 * @returns the same failure, its message cut
 */
export function cutMessage<E extends { readonly message: string }>({
  error,
  values,
}: {
  error: E;
  values: readonly UnprintableValue[];
}): E {
  return { ...error, message: cutValues({ text: error.message, values }) };
}

/**
 * Cut every listed value out of every string anywhere in a JSON-shaped document — keys included — so a
 * field nobody thought to name (a condition list, a field Google adds later) cannot carry one past `--json`.
 *
 * @param document the value about to be serialised
 * @param values what must not appear in any string of it
 * @returns the same shape with each string cut
 */
export function cutValuesDeep({
  document,
  values,
}: {
  document: unknown;
  values: readonly UnprintableValue[];
}): unknown {
  if (typeof document === "string") {
    return cutValues({ text: document, values });
  }
  if (Array.isArray(document)) {
    return document.map((entry: unknown) => cutValuesDeep({ document: entry, values }));
  }
  if (typeof document === "object" && document !== null) {
    // A key is cut as well: a label or annotation key is text the caller wrote, as free as any value.
    return Object.fromEntries(
      Object.entries(document).map(([key, entry]) => [
        cutValues({ text: key, values }),
        cutValuesDeep({ document: entry, values }),
      ]),
    );
  }
  return document;
}

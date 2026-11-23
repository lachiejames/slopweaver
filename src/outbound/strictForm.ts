/**
 * The one way an outbound form object is declared — strict, and LOUD about the key it refused.
 *
 * ## The failure this exists to prevent
 *
 * A ported alert payload was sent to the digest form carrying `impact`, `rootCause` and `fixStep` — the field
 * names of the system it was ported FROM — plus a `citations` array. The form was a plain `z.object`, so every
 * one of them was dropped. It validated, it previewed clean, it exited 0, and it posted a card whose entire
 * substance was missing. The only trace anywhere was an advisory warning that the card "carries no citations",
 * which was itself wrong: the composer had supplied one.
 *
 * Two separate defects produced that, and this module closes both:
 *
 *  1. **Silence.** A plain `z.object` DROPS an unknown key. Whether that is right depends on whether the key is
 *     an invention or a mistake, and nothing at parse time can tell them apart — so the only safe reading is
 *     that a key nobody declared is a key somebody meant. Every form here refuses.
 *  2. **An unhelpful refusal.** Zod's own message is `Unrecognized key: "impact"`, which names the key and
 *     stops there. Someone porting a payload needs to know WHERE that content goes, and the schema is the only
 *     thing that knows the answer. So the message names the nearest valid field, and lists the rest.
 *
 * ## Why a helper rather than a global error hook
 *
 * Zod's `unrecognized_keys` issue carries `inst`, the schema instance, so ONE global `z.config({ customError })`
 * could have produced this message everywhere with no call-site churn at all. That was rejected deliberately:
 * it is action at a distance. Someone reading a `z.strictObject` in a form file would have no way to know its
 * message came from somewhere else, and no gate can check that a global hook was installed before the first
 * parse. A named helper is visible where it is used and mechanically enforceable — the `outbound-form-strict`
 * ratchet fails the build on a raw `z.object` / `z.strictObject` anywhere under `src/outbound`.
 *
 * ## The previous rule this REPLACES
 *
 * `./artifact/schema.ts` used to state the rule as "refuse where a human authors, STRIP where a model fills unattended",
 * and `./artifact/digest.ts` was the strip side of it. The reasoning was that an unattended run should not die over an
 * invented field. Field use refuted it: the unattended run is precisely where nobody is watching, so a dropped
 * field is not a smaller failure there — it is a silent one. A refused send is visible and retryable; a card
 * that posted without its point is neither.
 */
import { z } from "zod";

import { nearestField } from "#lib/nearestField.js";

/**
 * The refusal message for one or more unknown keys: what was rejected, what it probably meant, and the full
 * field list so a porter can place content that belongs to no field at all.
 *
 * One line per key, because `violations()` at the CLI seam splits a message on newlines into separate reported
 * lines — so a form carrying four foreign keys reports four actionable lines rather than one dense one.
 *
 * @param keys the keys the schema refused
 * @param known every field the form declares
 * @returns the message, one line per rejected key plus a trailing field list
 */
export function unknownKeyMessage({ keys, known }: { keys: readonly string[]; known: readonly string[] }): string {
  const lines = keys.map((key) => {
    const suggestion = nearestField({ key, known });
    return suggestion === undefined
      ? `unknown field "${key}" — REFUSED, not ignored. No field here is close to it, so it is probably a field from another schema.`
      : `unknown field "${key}" — REFUSED, not ignored. Did you mean "${suggestion}"?`;
  });
  return [...lines, `this form's fields are: ${[...known].toSorted().join(", ")}`].join("\n");
}

/**
 * Declare an outbound form object. Strict, and it names the nearest valid field when it refuses one.
 *
 * The parameter is positional because a Zod raw shape is a `Record<string, …>` — a bag of fields, with a string
 * index signature — which is what the named-object-params rule asks of a single parameter. That keeps this a
 * drop-in for `z.strictObject` rather than forcing every form in the tree to be re-indented under a wrapper
 * key, which is the sort of churn that hides a real change inside a mechanical one.
 *
 * The custom error handles ONLY `unrecognized_keys` and returns `undefined` for everything else, which
 * preserves Zod's own wording for a wrong type, a missing field or a non-object input. That fall-through is
 * pinned by a test, because silently replacing every message on these schemas would be a far bigger regression
 * than the one this module fixes.
 *
 * @param shape the form's fields
 * @returns the strict Zod object schema for that shape
 */
export function strictForm<T extends z.core.$ZodLooseShape>(shape: T): z.ZodObject<T, z.core.$strict> {
  const known = Object.keys(shape);
  return z.strictObject(shape, {
    error: (issue) => (issue.code === "unrecognized_keys" ? unknownKeyMessage({ keys: issue.keys, known }) : undefined),
  });
}

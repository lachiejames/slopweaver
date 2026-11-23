import { verbTail } from "../../optionParsers.js";

export { verbTail };

/*
 * The `slice` noun's verb names.
 *
 * The one thing here exists because of a defect this noun would otherwise have inherited. The router hands a
 * verb handler the FULL argv — `[node, cli, noun, verb, …]` — so a noun that offers both a bare form and a
 * named verb has two different tails to strip: 3 for `slopweaver slice`, 4 for `slopweaver slice verify`.
 *
 * Nouns that hard-code `argv.slice(3)` get this wrong for their named form, and it is not hypothetical:
 * `slopweaver audit run` exits 2 with `unexpected argument: run` on `main` today, while `slopweaver audit`
 * works and the catalog advertises both. Computing the offset from the argv instead of assuming it is the
 * whole fix.
 */

/** Every verb the `slice` noun answers to. */
export const SLICE_VERBS: readonly string[] = ["capture", "verify"];

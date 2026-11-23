/**
 * The two pieces every write transport's privacy guard shares, whatever the provider: walking a payload down to
 * the strings it would send, and the refusal a stopped write is thrown with. Pure. Each provider decides which
 * keys are transport or destination rather than content (`./github/writePrivacyPayload.ts`,
 * `./slack/writePrivacyPayload.ts`); this module only walks and renders.
 */
import { type PrivateTerm, printableUnderTerms } from "../hygiene/privateTerms.js";

/** One string a guard judges, under the field path it sits at. */
export interface PayloadLeaf {
  /** The field path, `blocks[0].text.text`; a top-level key alone when the leaf sits there. */
  readonly path: string;
  readonly text: string;
}

/**
 * Every string leaf under one value, depth first, each under its field path. A cycle is walked once, and a key the
 * provider names as not content is skipped wherever it sits, with everything under it.
 *
 * @param value the payload, or any part of it
 * @param path the field path `value` sits at; empty at the root
 * @param skipKey whether an object key is transport or destination rather than content
 * @returns the leaves in walk order; none for a number, boolean or null
 */
export function payloadLeaves({
  value,
  path,
  skipKey,
}: {
  value: unknown;
  path: string;
  skipKey: (input: { readonly key: string; readonly depth: number }) => boolean;
}): readonly PayloadLeaf[] {
  return leavesOf({ depth: 0, path, seen: new Set<object>(), skipKey, value });
}

/** The walk {@link payloadLeaves} starts, carrying the objects already visited and the object depth. */
function leavesOf({
  value,
  path,
  seen,
  skipKey,
  depth,
}: {
  value: unknown;
  path: string;
  seen: Set<object>;
  skipKey: (input: { readonly key: string; readonly depth: number }) => boolean;
  depth: number;
}): readonly PayloadLeaf[] {
  if (typeof value === "string") {
    return [{ path, text: value }];
  }
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return [];
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown, index) =>
      leavesOf({ depth, path: `${path}[${String(index)}]`, seen, skipKey, value: item }),
    );
  }
  return Object.entries(value)
    .filter(([key]) => !skipKey({ depth, key }))
    .flatMap(([key, item]) =>
      leavesOf({ depth: depth + 1, path: path === "" ? key : `${path}.${key}`, seen, skipKey, value: item }),
    );
}

/**
 * The refusal a write is stopped with: what was stopped, why, and that there is no override. Each line is judged
 * against the private terms and printed as the stand-in when one matches, and the text as finally printed is judged
 * once more, since the indent and the line joins are added after each line was judged and could complete a match.
 *
 * @param command the operation, `github <METHOD> <template>` or `slack <method>`
 * @param reasons the policy-load refusal, or one redacted message per finding
 * @param terms the loaded private terms, none when they did not load: a line any of them matches is withheld
 * @returns the refusal text, its lines joined; the stand-in ALONE when a term matches the text as finally printed
 */
export function writePrivacyRefusal({
  command,
  reasons,
  terms,
}: {
  command: string;
  reasons: readonly string[];
  terms: readonly PrivateTerm[];
}): string {
  return printedUnderTerms({
    lines: [
      `${command} refused before sending: the outbound privacy check stopped it.`,
      ...reasons,
      "This is a refusal, with no override: reword the text, or repair the private terms file, then run the command again.",
    ],
    terms,
  });
}

/**
 * Lines as a guard prints them: the first flush, the rest indented, each judged against the private terms and the
 * joined text judged once more, since the indent and the joins could complete a match no single line held.
 *
 * @param lines the lines, headline first
 * @param terms the loaded private terms: a line any of them matches prints as the stand-in
 * @returns the text, or the stand-in ALONE when a term matches the text as finally printed
 */
export function printedUnderTerms({
  lines,
  terms,
}: {
  lines: readonly string[];
  terms: readonly PrivateTerm[];
}): string {
  const text = lines
    .map((line, index) => {
      const printed = printableUnderTerms({ line, terms });
      return index === 0 ? printed : `  ${printed}`;
    })
    .join("\n");
  return printableUnderTerms({ line: text, terms });
}

/**
 * The JSDoc-tag gate's defect vocabulary and its `@param` grader: what one documentation defect is, the
 * location-bound factory every check builds one with, and the check that grades a function's `@param` tags
 * against the parameter names `jsdocParamNames.ts` reports. Split from `jsdocTags.ts`, which walks a file's
 * exported functions and runs this grader on each. Pure — no AST, no I/O.
 */

import { novelWordCount } from "./commentQuality.js";
import type { ExpectedParams } from "./jsdocParamNames.js";

/**
 * What is wrong with one exported function's documentation.
 *
 * `missing-param` does not exist here on purpose (code-quality survey item 9, Option B): a `@param` may be
 * OMITTED when it would add nothing a reader does not already have from the signature. `stale-param` still
 * fires — a tag naming a parameter that no longer exists is doc rot regardless of whether presence is
 * mandatory — and a PRESENT tag that names a real parameter but adds no novel word is `low-information-param`.
 */
type JsdocDefectKind =
  | "no-block"
  | "no-description"
  | "stale-param"
  | "low-information-param"
  | "missing-returns"
  | "blank-description"
  | "unnameable-param"
  | "detached-block"
  | "duplicate-block"
  | "unread-tag";

/** One documentation defect: where it is, which function, and what exactly is wrong. */
export interface JsdocDefect {
  readonly path: string;
  readonly line: number;
  readonly name: string;
  readonly kind: JsdocDefectKind;
  readonly detail: string;
}

/** One defect factory bound to a function's location, so each check below stays a one-liner. */
export type DefectAt = ({ kind, detail }: { kind: JsdocDefectKind; detail: string }) => JsdocDefect;

/**
 * The `@param` defects: a tag naming no real parameter, or a present tag that earns none of its keep.
 *
 * There is no "undocumented parameter" defect here — Option B allows a `@param` to be omitted entirely when
 * it would add nothing, and this scanner cannot verify that counterfactual for a tag that was never written.
 * It can only grade tags that ARE present, which is what {@link novelWordCount} does below.
 *
 * @returns every parameter defect, in tag order
 */
export function paramDefects({
  tags,
  expected,
  at,
}: {
  tags: readonly { name: string; description: string }[];
  expected: ExpectedParams | undefined;
  at: DefectAt;
}): readonly JsdocDefect[] {
  const defects: JsdocDefect[] = [];
  if (expected === undefined) {
    // Fail closed rather than skip. A shape the scanner cannot name is a shape it cannot CHECK, and passing
    // it silently is indistinguishable in the output from having verified it — the exact failure this gate
    // family keeps paying for. Measured at zero occurrences across 1097 exported function-likes when this
    // landed, so the strictness is free; if a legitimate shape ever needs it, widen the scanner, not the hole.
    defects.push(
      at({
        detail:
          "this gate cannot enumerate the parameter's fields — inline the object type, or declare it in this " +
          "file, so a required field cannot hide behind a type the scanner cannot read",
        kind: "unnameable-param",
      }),
    );
    return defects;
  }
  const expectedSet = new Set(expected.names);
  for (const tag of tags) {
    // Only when the contract is fully visible. With a named type in the mix the caller may legitimately have
    // to pass a field we cannot see, so calling its tag stale would be the gate guessing.
    if (expected.complete && !expectedSet.has(tag.name)) {
      defects.push(
        at({
          detail: `@param "${tag.name}" names no parameter (expected: ${expected.names.join(", ")})`,
          kind: "stale-param",
        }),
      );
      continue;
    }
    if (novelWordCount({ description: tag.description, name: tag.name }) === 0) {
      const detail =
        tag.description === ""
          ? `@param "${tag.name}" has no description — omit the tag, or write one that adds something novel`
          : `@param "${tag.name}" adds nothing "${tag.name}" doesn't already say ("${tag.description}") — omit ` +
            "the tag, or write one that adds something novel";
      defects.push(at({ detail, kind: "low-information-param" }));
    }
  }
  return defects;
}

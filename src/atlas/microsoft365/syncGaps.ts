/**
 * The gaps the compiled sync writes onto every operation kind: the two standing ones no compile can close,
 * and one cross-kind gap per reviewed disposition rule that matched nothing.
 */
import { openMicrosoft365Gap } from "./gaps.js";
import type { Microsoft365AtlasGap, Microsoft365Kind } from "./model.js";

/**
 * The gaps an operation kind carries after a successful compile.
 *
 * @returns the two standing gaps followed by one gap for each disposition rule that never fired
 */
export function operationGaps({
  kind,
  deadRules,
  at,
}: {
  kind: Microsoft365Kind;
  deadRules: readonly string[];
  at: string;
}): readonly Microsoft365AtlasGap[] {
  const gaps: Microsoft365AtlasGap[] = [
    openMicrosoft365Gap({
      at,
      condition: "graph-credential-absent",
      fields: [],
      kind,
      reason:
        "the compiled surface says what Graph offers for this kind; nothing has asked this tenant for any " +
        "of it, because no application registration exists to ask with",
      scope: kind,
      surfaces: ["api"],
    }),
    openMicrosoft365Gap({
      at,
      condition: "beta-surface-not-compiled",
      fields: [],
      kind,
      reason:
        "Graph's `beta` surface carries operations `v1.0` does not, and several Entra console pages call " +
        "them. This atlas compiles `v1.0` only, by the pin in `specLock.ts`",
      scope: kind,
      surfaces: ["compiled"],
    }),
  ];
  for (const ruleId of deadRules) {
    gaps.push(
      openMicrosoft365Gap({
        at,
        condition: "disposition-rule-never-fired",
        fields: [],
        kind: null,
        reason: `the reviewed disposition rule \`${ruleId}\` matched no operation in the pinned document — a dead rule reads as considered judgement and is not one`,
        scope: ruleId,
        surfaces: ["compiled"],
      }),
    );
  }
  return gaps;
}

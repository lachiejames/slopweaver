/**
 * The gaps the `operation` kind carries after a successful compile — split out of `sync.ts`, whose overview
 * says why the two standing gaps are raised on every successful run.
 */
import { clerkDispositionRuleIds } from "./dispositions.js";
import { openClerkGap } from "./gaps.js";
import type { ClerkAtlasGap, ClerkAtlasKind } from "./model.js";
import type { ClerkOperationRow } from "./specRead.js";

/**
 * The gaps the operation kind carries after a successful compile.
 *
 * @returns the standing gaps and a gap for every disposition rule that did not fire
 */
export function compiledGaps({
  kind,
  operations,
  at,
}: {
  kind: ClerkAtlasKind;
  operations: readonly ClerkOperationRow[];
  at: string;
}): readonly ClerkAtlasGap[] {
  const gaps: ClerkAtlasGap[] = [
    openClerkGap({
      at,
      condition: "clerk-credential-absent",
      fields: [],
      kind,
      reason:
        "the compiled surface says what Clerk offers; nothing has asked this account for any of it, " +
        "because no secret key, publishable key or platform token exists to ask with",
      scope: kind,
      surfaces: ["api"],
    }),
    openClerkGap({
      at,
      condition: "clerk-api-versions-not-compiled",
      fields: [],
      kind,
      reason:
        "Clerk keeps six dated Backend API versions and six Frontend API versions published at once; this " +
        "atlas pins the newest of each. An installation pinned to an older version reads a surface this " +
        "atlas does not map",
      scope: kind,
      surfaces: ["compiled"],
    }),
  ];
  const fired = new Set(operations.map((row) => row.dispositionRuleId));
  for (const ruleId of clerkDispositionRuleIds().filter((id) => !fired.has(id))) {
    gaps.push(
      openClerkGap({
        at,
        condition: "disposition-rule-never-fired",
        fields: [],
        kind: null,
        reason: `the reviewed disposition rule \`${ruleId}\` matched no operation in the pinned documents — a dead rule reads as considered judgement and is not one`,
        scope: ruleId,
        surfaces: ["compiled"],
      }),
    );
  }
  return gaps;
}

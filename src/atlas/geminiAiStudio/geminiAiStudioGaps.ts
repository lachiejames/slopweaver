/*
 * Every gap this sync raises, and why four kinds of them are raised on EVERY successful run: none can be
 * closed by anything this verb does, and an atlas whose gap list emptied because the only pass that could
 * run had run would be reporting completeness it does not have.
 *
 * Imports the vocabulary and nothing else of this family, so it cannot see the cells or the kind files.
 */

import { geminiAiStudioDispositionRuleIds } from "./dispositions.js";
import { openGeminiAiStudioGap } from "./gaps.js";
import { GEMINI_AI_STUDIO_ENTITIES_HOLDER, type SpecRead } from "./geminiAiStudioSurfaces.js";
import { type GeminiAiStudioAtlasGap, type GeminiAiStudioKind } from "./model.js";
import { geminiAiStudioSpecPin, isGeminiAiStudioSpecVersion } from "./specLock.js";
import { type GeminiAiStudioSpecCensus } from "./specRead.js";
import { type GeminiAiStudioFoldOutcome, type GeminiAiStudioVersionDisagreement } from "./versions.js";

/**
 * Every way one document's own numbers differ from the census that was reviewed.
 *
 * Exported so a test can drive it without a network fetch: the deltas it reports are what a reader chases
 * when Google moves, and a check reachable only through a live endpoint is a check nothing exercises.
 *
 * @param census what this run measured for one version
 * @returns every difference, in English; empty when the document is exactly the reviewed one
 *
 * @internal
 */
export function censusDrift({ census }: { census: GeminiAiStudioSpecCensus }): readonly string[] {
  const { version } = census;
  if (!isGeminiAiStudioSpecVersion(version)) {
    return [`no reviewed census exists for version ${version}`];
  }
  const pin = geminiAiStudioSpecPin({ version });
  const problems: string[] = [];
  const expect = ({ label, got, want }: { label: string; got: string; want: string }): void => {
    if (got !== want) {
      problems.push(`${label}: read ${got}, reviewed ${want}`);
    }
  };
  expect({ got: census.revision, label: "revision", want: pin.revision });
  expect({ got: String(census.operationCount), label: "operations", want: String(pin.operationCount) });
  expect({ got: String(census.rootCount), label: "resource roots", want: String(pin.rootCount) });
  expect({ got: String(census.schemaCount), label: "schemas", want: String(pin.schemaCount) });
  const countOf = ({ method }: { method: string }): number => {
    const got = census.methodCounts[method];
    if (got === undefined) {
      return 0;
    }
    return got;
  };
  for (const [method, want] of Object.entries(pin.methodCounts)) {
    expect({ got: String(countOf({ method })), label: `${method} operations`, want: String(want) });
  }
  return problems;
}

/**
 * The gaps one operation kind carries after a successful compile.
 *
 * @returns the two permanent gaps every kind carries, plus one per version disagreement on this kind
 */
export function operationGaps({
  kind,
  disagreements,
  at,
}: {
  kind: GeminiAiStudioKind;
  disagreements: readonly GeminiAiStudioVersionDisagreement[];
  at: string;
}): readonly GeminiAiStudioAtlasGap[] {
  const gaps: GeminiAiStudioAtlasGap[] = [
    openGeminiAiStudioGap({
      at,
      condition: "api-credential-absent",
      fields: [],
      kind,
      reason:
        "the compiled surface says what the Gemini API offers for this kind; nothing has asked the platform " +
        "for any of it, because no API key exists to ask with",
      scope: kind,
      surfaces: ["api"],
    }),
    openGeminiAiStudioGap({
      at,
      condition: "entities-holder-is-a-surface-map",
      fields: [],
      kind,
      reason:
        `this kind's \`held-elsewhere\` cell names \`${GEMINI_AI_STUDIO_ENTITIES_HOLDER}\` as where this ` +
        "organisation's Gemini entities are reached, and that atlas is a SURFACE MAP rather than a store. " +
        "It maps the licence assignments, the policy schemas and the usage reports with the administrator " +
        "scope each needs, and its own live surface is declared-unfilled for want of one. So nothing in this " +
        "installation holds these records, and this gap stays open PERMANENTLY rather than being a defect to " +
        "close: an atlas that says nothing holds them is more useful than one that goes quiet about it",
      scope: kind,
      surfaces: ["api"],
    }),
  ];
  for (const disagreement of disagreements) {
    gaps.push(
      openGeminiAiStudioGap({
        at,
        condition: "version-shape-disagreement",
        fields: disagreement.fields,
        kind,
        reason: disagreement.reason,
        scope: disagreement.providerId,
        surfaces: ["compiled"],
      }),
    );
  }
  return gaps;
}

/**
 * The gaps that belong to no single kind, written onto every operation kind's file.
 *
 * The same shape `microsoft365/syncGaps.ts` uses for its dead-rule gaps, and for the same reason: a reader asks
 * `coverage --kind <k>` and a cross-kind fact that appeared under one arbitrary kind would be invisible from
 * every other one.
 *
 * @returns one gap per moved discovery document and one per disposition rule that matched nothing
 */
export function crossKindGaps({
  folded,
  specs,
  at,
}: {
  folded: GeminiAiStudioFoldOutcome;
  specs: readonly SpecRead[];
  at: string;
}): readonly GeminiAiStudioAtlasGap[] {
  const gaps: GeminiAiStudioAtlasGap[] = [];
  for (const spec of specs) {
    if (spec.drift.length === 0) {
      continue;
    }
    gaps.push(
      openGeminiAiStudioGap({
        at,
        condition: "spec-revision-moved",
        fields: [],
        kind: null,
        reason:
          `Google is serving a ${spec.version} discovery document that is not the one reviewed in ` +
          `\`specLock.ts\`: ${spec.drift.join("; ")}. This run compiled what arrived, because the endpoint ` +
          "is live by construction and refusing would stop the atlas tracking the platform. Re-review the " +
          "census and update the pin",
        scope: spec.version,
        surfaces: ["compiled"],
      }),
    );
  }
  const fired = new Set(folded.operations.map((operation) => operation.dispositionRuleId));
  for (const ruleId of geminiAiStudioDispositionRuleIds()) {
    if (fired.has(ruleId)) {
      continue;
    }
    gaps.push(
      openGeminiAiStudioGap({
        at,
        condition: "disposition-rule-never-fired",
        fields: [],
        kind: null,
        reason: `the reviewed disposition rule \`${ruleId}\` matched no operation in the published documents — a dead rule reads as considered judgement and is not one`,
        scope: ruleId,
        surfaces: ["compiled"],
      }),
    );
  }
  return gaps;
}

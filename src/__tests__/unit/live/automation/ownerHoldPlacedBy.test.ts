/**
 * Whether an owner hold carries the owner's words naming its automation — the check that exists because
 * `vulnfix-topup-acme-admin` was once held on a chair keypress written up as the owner's choice.
 *
 * Pure: the resolver is a plain function passed in, recording the anchors it was asked for.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "#lib/result.js";

import { HisWordsErrors } from "../../../../handover/hisWordsErrors.js";
import type { RawWords } from "../../../../handover/hisWordsResolve.js";
import {
  RECIPE_DEFINITION_SCHEMA_VERSION,
  type RecipeDefinition,
  type RecipeHold,
  type RecipeHoldPlacedBy,
} from "../../../../live/automation/definition.js";
import {
  classifyOwnerHoldPlacedBy,
  type OwnerHoldPlacedByState,
  ownerHoldIsOwners,
  ownerHoldPlacedByStateOf,
  type ResolveOwnerWords,
  withOwnerHoldPlacedByState,
} from "../../../../live/automation/ownerHoldPlacedBy.js";

const ANCHOR = "talk-call:a0000048-0000-4000-8000-000000000051#turn_000000000000000000025";

const HIS_RECORD = "Hold the vulnfix topup until\n  I have read the Tobias thread, then raise the batch as usual.";

/** A raw record carrying `text`. */
function raw({ text }: { text: string }): RawWords {
  return {
    atIso: "2026-10-19T11:48:00.000Z",
    context: { kind: "call-segment", open: undefined },
    headKnown: true,
    headLost: false,
    tailKnown: true,
    tailLost: false,
    text,
    where: "call",
  };
}

/** A resolver answering `text` at every anchor, recording each anchor it was asked for. */
function recordingResolver({ text, asked }: { text: string; asked: string[] }): ResolveOwnerWords {
  return ({ anchor }) => {
    asked.push(anchor);
    return ok(raw({ text }));
  };
}

/** What a reader takes the row's standing owner hold to be. */
function stateOf({ definition }: { definition: RecipeDefinition }): OwnerHoldPlacedByState {
  return ownerHoldPlacedByStateOf({ definition: { ...definition, hold: definition.hold! } });
}

/** The security top-up row, held by an owner hold overridable field by field. */
function heldRow({ hold, names }: { hold: Partial<RecipeHold>; names?: readonly string[] }): RecipeDefinition {
  return {
    cadence: "0 2 * * *",
    destination: { kind: "local-atlas" },
    effect: "read",
    enabled: true,
    hold: { askedIso: "2026-10-17T08:55:40.188Z", clearedBy: null, reason: "held", ...hold },
    kind: "verb-run",
    names,
    onMissed: "skip",
    params: { argv: ["vulnfix", "topup"] },
    recipeId: "vulnfix-topup-acme-admin",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  };
}

describe("classifyOwnerHoldPlacedBy", () => {
  it("reads a hold with no placedBy as unanchored", () => {
    expect(classifyOwnerHoldPlacedBy({ names: ["vulnfix"], placedBy: undefined, reading: undefined })).toEqual({
      kind: "unanchored",
    });
  });

  it("matches the owner's words across a line wrap and a case change", () => {
    const state = classifyOwnerHoldPlacedBy({
      names: ["vulnfix-topup-acme-admin", "vulnfix topup"],
      placedBy: { anchor: ANCHOR, words: "hold the VULNFIX topup until I have read" },
      reading: { kind: "resolved", text: HIS_RECORD },
    });

    expect(state).toEqual({ kind: "anchored" });
  });

  it("refuses words that are not in the owner's record", () => {
    const state = classifyOwnerHoldPlacedBy({
      names: ["vulnfix"],
      placedBy: { anchor: ANCHOR, words: "hold the vulnfix topup forever" },
      reading: { kind: "resolved", text: HIS_RECORD },
    });

    expect(state).toEqual({
      kind: "unresolved",
      reason: `the words on the hold are not in the owner's record at ${ANCHOR}`,
    });
  });

  it("refuses the owner's real words when they name no name of this automation — a steer is not a hold on it", () => {
    const state = classifyOwnerHoldPlacedBy({
      names: ["vulnfix-topup-acme-admin", "vulnfix"],
      placedBy: { anchor: ANCHOR, words: "lead with the discussion" },
      reading: { kind: "resolved", text: "Always lead with the discussion, never the PR." },
    });

    expect(state).toEqual({
      kind: "unresolved",
      reason: "the owner's words on the hold name none of this automation's names (vulnfix-topup-acme-admin, vulnfix)",
    });
  });

  it("never reads a name inside a longer one as naming this row", () => {
    const state = classifyOwnerHoldPlacedBy({
      names: ["row-a"],
      placedBy: { anchor: ANCHOR, words: "pause row-alpha" },
      reading: { kind: "resolved", text: "please pause row-alpha" },
    });

    expect(state).toEqual({
      kind: "unresolved",
      reason: "the owner's words on the hold name none of this automation's names (row-a)",
    });
  });

  it("reads a letter outside the Basic Multilingual Plane as continuing the name, on either side", () => {
    const after = classifyOwnerHoldPlacedBy({
      names: ["row-a"],
      placedBy: { anchor: ANCHOR, words: "pause row-a\u{10400}" },
      reading: { kind: "resolved", text: "pause row-a\u{10400}" },
    });
    const before = classifyOwnerHoldPlacedBy({
      names: ["row-a"],
      placedBy: { anchor: ANCHOR, words: "pause \u{10400}row-a" },
      reading: { kind: "resolved", text: "pause \u{10400}row-a" },
    });

    expect([after.kind, before.kind]).toEqual(["unresolved", "unresolved"]);
  });

  it("reads a Unicode hyphen or a combining mark as continuing the name", () => {
    const hyphen = classifyOwnerHoldPlacedBy({
      names: ["row-a"],
      placedBy: { anchor: ANCHOR, words: "pause row-a‐suffix" },
      reading: { kind: "resolved", text: "pause row-a‐suffix" },
    });
    const mark = classifyOwnerHoldPlacedBy({
      names: ["row-a"],
      placedBy: { anchor: ANCHOR, words: "pause row-á" },
      reading: { kind: "resolved", text: "pause row-á" },
    });

    expect([hyphen.kind, mark.kind]).toEqual(["unresolved", "unresolved"]);
  });

  it("takes a whole name that a later occurrence carries after a longer one, and one ended by punctuation", () => {
    const state = classifyOwnerHoldPlacedBy({
      names: ["row-a"],
      placedBy: { anchor: ANCHOR, words: "pause row-alpha and row-a, both" },
      reading: { kind: "resolved", text: "please pause row-alpha and row-a, both are noisy" },
    });

    expect(state).toEqual({ kind: "anchored" });
  });

  it("carries the reader's own reason when the record could not be read", () => {
    const state = classifyOwnerHoldPlacedBy({
      names: ["vulnfix"],
      placedBy: { anchor: ANCHOR, words: "hold the vulnfix topup" },
      reading: { kind: "unresolved", reason: "the call holds no such segment" },
    });

    expect(state).toEqual({ kind: "unresolved", reason: "the call holds no such segment" });
  });
});

describe("withOwnerHoldPlacedByState", () => {
  it("derives unanchored without reading anything when the hold carries no placedBy", () => {
    const asked: string[] = [];

    const audited = withOwnerHoldPlacedByState({
      definition: heldRow({ hold: {} }),
      resolveOwnerWords: recordingResolver({ asked, text: HIS_RECORD }),
    });

    expect(stateOf({ definition: audited })).toEqual({ kind: "unanchored" });
    expect(asked).toEqual([]);
  });

  it("refuses an anchor its scheme's parser does not take, without reading anything", () => {
    const asked: string[] = [];

    const audited = withOwnerHoldPlacedByState({
      definition: heldRow({ hold: { placedBy: { anchor: "the chair, 17 Oct", words: "vulnfix" } } }),
      resolveOwnerWords: recordingResolver({ asked, text: HIS_RECORD }),
    });

    expect(stateOf({ definition: audited })).toEqual({
      kind: "unresolved",
      reason: "the anchor the chair, 17 Oct is not one the owner-words reader parses",
    });
    expect(asked).toEqual([]);
  });

  it("anchors a hold on its recipeId alone when the row declares no names", () => {
    const asked: string[] = [];

    const audited = withOwnerHoldPlacedByState({
      definition: heldRow({ hold: { placedBy: { anchor: ANCHOR, words: "pause vulnfix-topup-acme-admin" } } }),
      resolveOwnerWords: recordingResolver({ asked, text: "please pause vulnfix-topup-acme-admin tonight" }),
    });

    expect(stateOf({ definition: audited })).toEqual({ kind: "anchored" });
    expect(asked).toEqual([ANCHOR]);
  });

  it("anchors a hold on a declared alias", () => {
    const audited = withOwnerHoldPlacedByState({
      definition: heldRow({
        hold: { placedBy: { anchor: ANCHOR, words: "Hold the vulnfix topup" } },
        names: ["vulnfix topup"],
      }),
      resolveOwnerWords: recordingResolver({ asked: [], text: HIS_RECORD }),
    });

    expect(stateOf({ definition: audited })).toEqual({ kind: "anchored" });
  });

  it("never anchors a hold on words the record says were cut, or does not say were whole", () => {
    const words = "please pause vulnfix-topup-acme-admin tonight";
    const audit = (cut: Partial<Pick<RawWords, "headKnown" | "headLost" | "tailLost">>): OwnerHoldPlacedByState =>
      stateOf({
        definition: withOwnerHoldPlacedByState({
          definition: heldRow({ hold: { placedBy: { anchor: ANCHOR, words: "pause vulnfix-topup-acme-admin" } } }),
          resolveOwnerWords: () => ok({ ...raw({ text: words }), ...cut }),
        }),
      });

    expect([audit({ tailLost: true }), audit({ headLost: true }), audit({ headKnown: false }), audit({})]).toEqual([
      { kind: "unresolved", reason: `the owner's words at ${ANCHOR} were cut before they finished` },
      { kind: "unresolved", reason: `the owner's words at ${ANCHOR} lost their start` },
      { kind: "unresolved", reason: `the record at ${ANCHOR} predates saying whether its words were cut` },
      { kind: "anchored" },
    ]);
  });

  // A capital sigma lowercases by what follows it, so "ΟΣ" quoted from "ΟΣ'Α" folded apart from it.
  it("anchors words quoted from a record however a capital sigma in them lowercases", () => {
    const state = stateOf({
      definition: withOwnerHoldPlacedByState({
        definition: heldRow({ hold: { placedBy: { anchor: ANCHOR, words: "pause vulnfix-topup-acme-admin ΟΣ" } } }),
        resolveOwnerWords: () => ok(raw({ text: "pause vulnfix-topup-acme-admin ΟΣ'Α" })),
      }),
    });
    expect(state).toEqual({ kind: "anchored" });
  });

  it("carries a resolver failure's message as the reason", () => {
    const audited = withOwnerHoldPlacedByState({
      definition: heldRow({ hold: { placedBy: { anchor: ANCHOR, words: "vulnfix" } } }),
      resolveOwnerWords: ({ anchor }) => err(HisWordsErrors.recordMissing({ anchor, what: "no such call" })),
    });

    expect(stateOf({ definition: audited })).toEqual({ kind: "unresolved", reason: `${ANCHOR}: no such call` });
  });

  it("leaves a failure hold and a cleared owner hold untouched, reading nothing", () => {
    const asked: string[] = [];
    const resolveOwnerWords = recordingResolver({ asked, text: HIS_RECORD });
    const failure = heldRow({ hold: { finding: "recipe-failing-vulnfix" } });
    const cleared = heldRow({
      hold: { clearedBy: { atIso: "2026-10-19T11:44:00.000Z", runSlug: "lift-it" }, placedBy: undefined },
    });

    expect(withOwnerHoldPlacedByState({ definition: failure, resolveOwnerWords })).toBe(failure);
    expect(withOwnerHoldPlacedByState({ definition: cleared, resolveOwnerWords })).toBe(cleared);
    expect(asked).toEqual([]);
  });
});

describe("ownerHoldPlacedByStateOf", () => {
  const anchoredWords: RecipeHoldPlacedBy = { anchor: ANCHOR, words: "Hold the vulnfix topup" };

  it("follows the audited row through a spread copy of its hold", () => {
    const audited = withOwnerHoldPlacedByState({
      definition: heldRow({ hold: { placedBy: anchoredWords }, names: ["vulnfix topup"] }),
      resolveOwnerWords: recordingResolver({ asked: [], text: HIS_RECORD }),
    });
    const copied: RecipeDefinition = { ...audited, hold: { ...audited.hold!, reason: "still held" } };

    expect(stateOf({ definition: copied })).toEqual({ kind: "anchored" });
  });

  it("never vouches for a placedBy no audit read, whatever its words", () => {
    const handBuilt = heldRow({ hold: { placedBy: { anchor: "talk:missing", words: "unrelated words" } } });

    expect(stateOf({ definition: handBuilt })).toEqual({
      kind: "unresolved",
      reason: "this view did not read the hold's anchor",
    });
  });

  it("never vouches for the row it read, once its placedBy is a fresh copy of the same words", () => {
    const audited = withOwnerHoldPlacedByState({
      definition: heldRow({ hold: { placedBy: anchoredWords }, names: ["vulnfix topup"] }),
      resolveOwnerWords: recordingResolver({ asked: [], text: HIS_RECORD }),
    });
    const rebuilt: RecipeDefinition = { ...audited, hold: { ...audited.hold!, placedBy: { ...anchoredWords } } };

    expect(stateOf({ definition: rebuilt })).toEqual({
      kind: "unresolved",
      reason: "this view did not read the hold's anchor",
    });
  });

  it("refuses a judged placedBy moved onto another automation's hold", () => {
    const audited = withOwnerHoldPlacedByState({
      definition: heldRow({ hold: { placedBy: anchoredWords }, names: ["vulnfix topup"] }),
      resolveOwnerWords: recordingResolver({ asked: [], text: HIS_RECORD }),
    });
    const moved: RecipeDefinition = { ...audited, names: undefined, recipeId: "atlas-freshness" };

    expect(stateOf({ definition: moved })).toEqual({
      kind: "unresolved",
      reason: "the hold's words were read for another automation",
    });
  });

  it("never reuses a judgement for a name list that only joins to the same text", () => {
    const audited = withOwnerHoldPlacedByState({
      definition: heldRow({ hold: { placedBy: anchoredWords }, names: ["vulnfix topup", "beta"] }),
      resolveOwnerWords: recordingResolver({ asked: [], text: HIS_RECORD }),
    });
    const renamed: RecipeDefinition = { ...audited, names: ["vulnfix topup\nbeta"] };

    expect(stateOf({ definition: renamed })).toEqual({
      kind: "unresolved",
      reason: "the hold's words were read for another automation",
    });
  });

  it("freezes the placedBy it judged, so its words cannot be edited after the read", () => {
    const audited = withOwnerHoldPlacedByState({
      definition: heldRow({ hold: { placedBy: anchoredWords }, names: ["vulnfix topup"] }),
      resolveOwnerWords: recordingResolver({ asked: [], text: HIS_RECORD }),
    });

    expect(Object.isFrozen(audited.hold!.placedBy)).toBe(true);
  });

  it("reads a hold with no placedBy as unanchored in any view", () => {
    expect(stateOf({ definition: heldRow({ hold: {} }) })).toEqual({ kind: "unanchored" });
  });
});

describe("ownerHoldIsOwners", () => {
  it("takes the anchored state the audit minted as the owner's", () => {
    const audited = withOwnerHoldPlacedByState({
      definition: heldRow({
        hold: { placedBy: { anchor: ANCHOR, words: "Hold the vulnfix topup" } },
        names: ["vulnfix"],
      }),
      resolveOwnerWords: recordingResolver({ asked: [], text: HIS_RECORD }),
    });

    const state = stateOf({ definition: audited });

    expect([
      ownerHoldIsOwners({ recipeId: "vulnfix-topup-acme-admin", state }),
      ownerHoldIsOwners({ recipeId: "atlas-freshness", state }),
    ]).toEqual([true, false]);
  });

  it("never takes a hand-spelled anchored state as the owner's", () => {
    expect(ownerHoldIsOwners({ recipeId: "vulnfix-topup-acme-admin", state: { kind: "anchored" } })).toBe(false);
  });

  it("never takes the classifier's own anchored answer as the owner's, since its reading is the caller's", () => {
    const state = classifyOwnerHoldPlacedBy({
      names: ["vulnfix"],
      placedBy: { anchor: ANCHOR, words: "vulnfix" },
      reading: { kind: "resolved", text: "vulnfix" },
    });

    expect([state.kind, ownerHoldIsOwners({ recipeId: "vulnfix-topup-acme-admin", state })]).toEqual([
      "anchored",
      false,
    ]);
  });
});

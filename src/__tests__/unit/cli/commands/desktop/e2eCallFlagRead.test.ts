import { describe, expect, it } from "vitest";

import {
  callCardOf,
  holdMinutesOf,
  micCandidateOf,
  pickRefusal,
} from "../../../../../cli/commands/desktop/e2eCallFlagRead.js";
import { E2eCallFlagErrors } from "../../../../../desktop/e2eCallErrors.js";
import { CALL_HOLD_DEFAULT_MINUTES, type DesktopE2ePick } from "../../../../../desktop/e2eCallPlan.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

/** A synthetic hand note's key, never this install's own. */
const CARD = "hand:acme-sample-note";

/** A pick that can run: nothing unknown, nothing missing its flag. */
const RUNNABLE: DesktopE2ePick = {
  calls: [],
  cardSurfaces: [],
  needsCall: [],
  needsCandidate: [],
  needsCard: [],
  unknown: [],
  walk: [],
};

describe("pickRefusal", () => {
  it("lets a pick with nothing unknown or missing run", () => {
    expect(pickRefusal({ picked: RUNNABLE })).toBeUndefined();
  });

  it("names each missing flag's own refusal", () => {
    expect([
      pickRefusal({ picked: { ...RUNNABLE, needsCall: ["call-holds"] } }),
      pickRefusal({ picked: { ...RUNNABLE, needsCard: ["card-read"] } }),
      pickRefusal({ picked: { ...RUNNABLE, needsCandidate: ["transcription-fidelity"] } }),
    ]).toEqual([
      E2eCallFlagErrors.scenarioWithoutCall({ ids: ["call-holds"] }).message,
      E2eCallFlagErrors.cardScenarioWithoutCard().message,
      E2eCallFlagErrors.fidelityWithoutCandidate().message,
    ]);
  });

  it("within one pick, refuses an unknown id ahead of a missing flag", () => {
    const refused = pickRefusal({ picked: { ...RUNNABLE, needsCall: ["call-holds"], unknown: ["nope"] } });
    expect(refused).toContain("--only names no step: nope (the steps: ");
  });
});

describe("holdMinutesOf", () => {
  it("takes the default when no hold is named, with or without the call leg", () => {
    expect([
      unwrap(holdMinutesOf({ call: false, hold: undefined })),
      unwrap(holdMinutesOf({ call: true, hold: undefined })),
    ]).toEqual([CALL_HOLD_DEFAULT_MINUTES, CALL_HOLD_DEFAULT_MINUTES]);
  });

  it("reads a whole number of minutes on the call leg", () => {
    expect(unwrap(holdMinutesOf({ call: true, hold: "7" }))).toBe(7);
  });

  it("refuses a hold without the call leg it configures", () => {
    expect(unwrapErr(holdMinutesOf({ call: false, hold: "7" }))).toEqual([E2eCallFlagErrors.holdWithoutCall().message]);
  });

  it("refuses a hold that is not a whole number", () => {
    expect(unwrapErr(holdMinutesOf({ call: true, hold: "1.5" }))[0]).toContain(
      "--call-hold-minutes takes a whole number",
    );
  });
});

describe("callCardOf", () => {
  it("names no card when the flag is absent, with or without the call leg", () => {
    expect([
      unwrap(callCardOf({ call: false, card: undefined })),
      unwrap(callCardOf({ call: true, card: undefined })),
    ]).toEqual([{ kind: "none" }, { kind: "none" }]);
  });

  it("takes card keys exactly as the console names them, once each, or every open card", () => {
    expect([
      unwrap(callCardOf({ call: true, card: CARD })),
      unwrap(callCardOf({ call: true, card: `${CARD}, act:acme-1,${CARD}` })),
      unwrap(callCardOf({ call: true, card: "all" })),
    ]).toEqual([{ keys: [CARD], kind: "named" }, { keys: [CARD, "act:acme-1"], kind: "named" }, { kind: "inventory" }]);
  });

  it("refuses a card without the call leg it configures", () => {
    expect(unwrapErr(callCardOf({ call: false, card: CARD }))).toEqual([E2eCallFlagErrors.cardWithoutCall().message]);
  });

  it("refuses a key of no register's kind, a key with no id, a recipe and an empty list, naming each", () => {
    expect([
      unwrapErr(callCardOf({ call: true, card: "nope:acme" })),
      unwrapErr(callCardOf({ call: true, card: "hand:" })),
      unwrapErr(callCardOf({ call: true, card: `${CARD},recipe:acme,candidate:acme` })),
      unwrapErr(callCardOf({ call: true, card: " , " })),
    ]).toEqual([
      [E2eCallFlagErrors.cardInvalid({ key: "nope:acme" }).message],
      [E2eCallFlagErrors.cardInvalid({ key: "hand:" }).message],
      [E2eCallFlagErrors.cardInvalid({ key: "recipe:acme, candidate:acme" }).message],
      [E2eCallFlagErrors.cardInvalid({ key: " , " }).message],
    ]);
  });
});

describe("micCandidateOf", () => {
  const FIDELITY = ["transcription-fidelity"];

  it("reads a named candidate beside the fidelity scenario, and nothing when none is named", () => {
    expect([
      unwrap(micCandidateOf({ ids: FIDELITY, text: "noise-suppression-off" })),
      unwrap(micCandidateOf({ ids: [], text: undefined })),
    ]).toEqual(["noise-suppression-off", undefined]);
  });

  it("refuses a candidate without the scenario it configures, and control or an unknown name", () => {
    expect([
      unwrapErr(micCandidateOf({ ids: ["call-live"], text: "both-off" })),
      unwrapErr(micCandidateOf({ ids: FIDELITY, text: "control" })),
    ]).toEqual([
      [E2eCallFlagErrors.candidateWithoutFidelity().message],
      [E2eCallFlagErrors.micCandidateInvalid({ candidate: "control" }).message],
    ]);
  });
});

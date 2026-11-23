import { describe, expect, it } from "vitest";
import { HandStepErrors } from "../../../hand/errors.js";
import { HandPostingErrors } from "../../../hand/handPostingErrors.js";
import { HandRegisterErrors } from "../../../hand/handRegisterErrors.js";
import { HandSurfaceErrors } from "../../../hand/handSurfaceErrors.js";

/*
 * The hand domain keeps ONE union and ONE factory object, composed in `errors.ts` from three concern groups. These
 * guard the composition: each group's exact keys, the whole object being the three spread contiguously in order,
 * and every factory still building the variant its key names. Message strings stay the subject of the tests of
 * the verbs that raise them.
 */
const POSTING_KEYS = [
  "invalidField",
  "invalidId",
  "fleetCanDoIt",
  "proofWitnessIsOurs",
  "purchaseAsk",
  "fleetWord",
  "decisionWithoutAsk",
  "secretNameUnregistered",
  "secretNameUnsettable",
];
const REGISTER_KEYS = [
  "corruptRow",
  "unwritableRow",
  "unknownStep",
  "stepIdConflict",
  "rowAlreadyOpen",
  "rowNotNameable",
  "postingNotAdmitted",
  "registerIncomplete",
  "registerBusy",
  "storeUnreadable",
];
const SURFACE_KEYS = ["notThisPlatform", "surfaceFailed", "laterLedger", "snoozeStore", "invalidSnooze"];

describe("HandPostingErrors", () => {
  it("declares the posting-time refusals, in their register order", () => {
    expect(Object.keys(HandPostingErrors).length).toBeGreaterThan(0);
    expect(Object.keys(HandPostingErrors)).toEqual(POSTING_KEYS);
  });

  it("builds an unsettable secret name with every payload field", () => {
    expect(
      HandPostingErrors.secretNameUnsettable({ name: "acme-token", retired: true, writtenBy: "a grant file" }),
    ).toEqual({
      code: "SECRET_NAME_UNSETTABLE",
      message:
        "the step has the owner run `slopweaver secrets set acme-token`, and the secrets registry says `secrets set` " +
        "refuses that name — it is retired, so nothing reads it: drop it from the step and have the owner store nothing",
      name: "acme-token",
      retired: true,
      writtenBy: "a grant file",
    });
  });

  it("points a live unsettable name at how its value really gets into the store", () => {
    expect(
      HandPostingErrors.secretNameUnsettable({ name: "acme-token", retired: false, writtenBy: "a grant file" }).message,
    ).toContain("its value gets into the store by: a grant file. Post that step instead");
  });
});

describe("HandRegisterErrors", () => {
  it("declares the register and row-store failures, in their register order", () => {
    expect(Object.keys(HandRegisterErrors).length).toBeGreaterThan(0);
    expect(Object.keys(HandRegisterErrors)).toEqual(REGISTER_KEYS);
  });

  it("builds an unreadable store carrying its path and cause", () => {
    const cause = new Error("EACCES");
    expect(HandRegisterErrors.storeUnreadable({ cause, path: "/tmp/sw-home/hand.jsonl" })).toEqual({
      cause,
      code: "STORE_UNREADABLE",
      message:
        "could not read the hand-step register at /tmp/sw-home/hand.jsonl — refusing rather than reporting it empty",
      path: "/tmp/sw-home/hand.jsonl",
    });
  });
});

describe("HandSurfaceErrors", () => {
  it("declares the surface and ledger failures, in their register order", () => {
    expect(Object.keys(HandSurfaceErrors).length).toBeGreaterThan(0);
    expect(Object.keys(HandSurfaceErrors)).toEqual(SURFACE_KEYS);
  });

  it("builds an invalid snooze naming the step and why", () => {
    expect(HandSurfaceErrors.invalidSnooze({ id: "sign-in", why: "no answer instant" })).toEqual({
      code: "INVALID_SNOOZE",
      id: "sign-in",
      message: "the snooze on sign-in has no wake time this register can trust: no answer instant",
      why: "no answer instant",
    });
  });
});

describe("HandStepErrors", () => {
  it("is the three groups spread into one flat object, contiguously and in order", () => {
    expect(Object.keys(HandStepErrors)).toEqual([...POSTING_KEYS, ...REGISTER_KEYS, ...SURFACE_KEYS]);
    expect(Object.keys(HandStepErrors)).toEqual([
      ...Object.keys(HandPostingErrors),
      ...Object.keys(HandRegisterErrors),
      ...Object.keys(HandSurfaceErrors),
    ]);
  });

  it("builds every variant under the code its key names", () => {
    const cause = new Error("inert");
    expect([
      HandStepErrors.invalidField({ field: "what", why: "is empty" }).code,
      HandStepErrors.invalidId({ id: "X" }).code,
      HandStepErrors.fleetCanDoIt({ phrase: "the session" }).code,
      HandStepErrors.proofWitnessIsOurs({ phrase: "proof" }).code,
      HandStepErrors.purchaseAsk({ phrase: "top up" }).code,
      HandStepErrors.fleetWord({ means: "a thing", word: "seat" }).code,
      HandStepErrors.decisionWithoutAsk({ id: "pick", phrase: "decide" }).code,
      HandStepErrors.secretNameUnregistered({ names: ["acme-token"] }).code,
      HandStepErrors.secretNameUnsettable({ name: "acme-token", retired: false, writtenBy: "a grant file" }).code,
      HandStepErrors.corruptRow({ lineNumber: 3, why: "no id" }).code,
      HandStepErrors.unwritableRow({ why: "no id" }).code,
      HandStepErrors.unknownStep({ id: "pick" }).code,
      HandStepErrors.stepIdConflict({ field: "what", id: "pick" }).code,
      HandStepErrors.rowAlreadyOpen({ existingId: "pick", row: "run-1" }).code,
      HandStepErrors.rowNotNameable({ row: "run-1", why: "finished" }).code,
      HandStepErrors.registerIncomplete({ lineNumbers: [2, 5] }).code,
      HandStepErrors.registerBusy({ why: "locked" }).code,
      HandStepErrors.storeUnreadable({ cause, path: "/tmp/sw-home/hand.jsonl" }).code,
      HandStepErrors.notThisPlatform({ platform: "linux" }).code,
      HandStepErrors.surfaceFailed({ cause, surface: "note" }).code,
      HandStepErrors.laterLedger({ cause: "disk full", path: "/tmp/sw-home/later.jsonl" }).code,
      HandStepErrors.snoozeStore({ cause: "disk full", path: "/tmp/sw-home/snooze.jsonl" }).code,
      HandStepErrors.invalidSnooze({ id: "pick", why: "no instant" }).code,
    ]).toEqual([
      "INVALID_FIELD",
      "INVALID_ID",
      "FLEET_CAN_DO_IT",
      "PROOF_WITNESS_IS_OURS",
      "PURCHASE_ASK",
      "FLEET_WORD",
      "DECISION_WITHOUT_ASK",
      "SECRET_NAME_UNREGISTERED",
      "SECRET_NAME_UNSETTABLE",
      "CORRUPT_ROW",
      "UNWRITABLE_ROW",
      "UNKNOWN_STEP",
      "STEP_ID_CONFLICT",
      "ROW_ALREADY_OPEN",
      "ROW_NOT_NAMEABLE",
      "REGISTER_INCOMPLETE",
      "REGISTER_BUSY",
      "STORE_UNREADABLE",
      "NOT_THIS_PLATFORM",
      "SURFACE_FAILED",
      "LATER_LEDGER",
      "SNOOZE_STORE",
      "INVALID_SNOOZE",
    ]);
  });
});

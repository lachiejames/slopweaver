/*
 * The Queue's reading of a draft sent back for its proof: ten V-card drafts that reached the owner with no
 * screenshot are held and read as lacking their proof, not shown as ready.
 */

import { describe, expect, it } from "vitest";

import { DRAFT_PROOF_MISSING as RECORDED } from "../../../src/outbound/slack/draftProofPieces";
import {
  DRAFT_PROOF_MISSING,
  draftProofFieldsOf,
  draftProofMissingOf,
  proofMissingLine,
} from "../../components/live/draftProofMissing";

describe("DRAFT_PROOF_MISSING", () => {
  it("is the recorder's own list, so a piece the CLI names is one the card can state", () => {
    expect(DRAFT_PROOF_MISSING.length).toBeGreaterThan(0);
    expect([...DRAFT_PROOF_MISSING]).toEqual([...RECORDED]);
  });
});

describe("draftProofMissingOf", () => {
  it("reads the pieces a row lacks, in order", () => {
    expect(draftProofMissingOf({ item: { proofMissing: ["screenshot", "impact"] } })).toEqual(["screenshot", "impact"]);
  });

  it("reads a first message's missing annotation", () => {
    expect(draftProofMissingOf({ item: { proofMissing: ["annotation"] } })).toEqual(["annotation"]);
  });

  it("reads an absent field as a row carrying no verdict", () => {
    expect(draftProofMissingOf({ item: {} })).toBe(undefined);
  });

  it("is malformed for an empty list, a piece it does not know, or a value that is no list", () => {
    expect(draftProofMissingOf({ item: { proofMissing: [] } })).toBe("malformed");
    expect(draftProofMissingOf({ item: { proofMissing: ["screenshot", "receipt"] } })).toBe("malformed");
    expect(draftProofMissingOf({ item: { proofMissing: "screenshot" } })).toBe("malformed");
  });
});

describe("draftProofFieldsOf", () => {
  const RECEIPT = { notes: ["the failing control"], sha256: "a".repeat(64) };
  const attached = [RECEIPT.sha256];

  it("reads a held row's receipt, a held row's send-back, and a row carrying neither", () => {
    expect([
      draftProofFieldsOf({ attached, held: true, item: { leadingReceipt: RECEIPT } }),
      draftProofFieldsOf({ attached: [], held: true, item: { proofMissing: ["annotation"] } }),
      draftProofFieldsOf({ attached: [], held: false, item: {} }),
    ]).toEqual([{ leadingReceipt: RECEIPT }, { proofMissing: ["annotation"] }, {}]);
  });

  it("is malformed for a receipt beside a send-back, either field on a resolved row, or a receipt it cannot draw", () => {
    expect([
      draftProofFieldsOf({ attached, held: true, item: { leadingReceipt: RECEIPT, proofMissing: ["link"] } }),
      draftProofFieldsOf({ attached, held: false, item: { leadingReceipt: RECEIPT } }),
      draftProofFieldsOf({ attached, held: false, item: { proofMissing: ["link"] } }),
      draftProofFieldsOf({ attached, held: true, item: { leadingReceipt: { ...RECEIPT, notes: [] } } }),
      draftProofFieldsOf({ attached, held: true, item: { leadingReceipt: { ...RECEIPT, sha256: "nope" } } }),
      draftProofFieldsOf({ attached, held: true, item: { leadingReceipt: { ...RECEIPT, extra: 1 } } }),
      draftProofFieldsOf({ attached, held: true, item: { leadingReceipt: { ...RECEIPT, notes: ["   "] } } }),
    ]).toEqual(["malformed", "malformed", "malformed", "malformed", "malformed", "malformed", "malformed"]);
  });

  it("is malformed for a receipt naming bytes the row does not carry", () => {
    expect([
      draftProofFieldsOf({ attached: [], held: true, item: { leadingReceipt: RECEIPT } }),
      draftProofFieldsOf({ attached: ["b".repeat(64)], held: true, item: { leadingReceipt: RECEIPT } }),
    ]).toEqual(["malformed", "malformed"]);
  });
});

describe("proofMissingLine", () => {
  it("says what sd-b5a68451 lacked and that it was sent back unseen", () => {
    expect(proofMissingLine({ missing: ["screenshot", "impact"] })).toBe(
      "It came without its proof (no screenshot, no impact in people), so it was sent back unseen.",
    );
  });

  it("says a first message's screenshot carried no box", () => {
    expect(proofMissingLine({ missing: ["annotation"] })).toBe(
      "It came without its proof (no annotated, unobstructed screenshot), so it was sent back unseen.",
    );
  });
});

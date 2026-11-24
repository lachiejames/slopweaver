/**
 * A proposal is stale exactly when its recorded base digest differs from the file state just read, absence included.
 */
import { describe, expect, it } from "vitest";

import {
  type PrivateTermsFileState,
  type PrivateTermsProposal,
  privateTermsBaseSha256,
  privateTermsProposalIsStale,
} from "../../../hygiene/privateTermsProposal.js";

const proposalOver = ({ baseSha256 }: { baseSha256: string | null }): PrivateTermsProposal => ({
  action: "add",
  baseSha256,
  createdAtIso: "2026-11-22T00:00:00.000Z",
  proposalId: "pp-00000000000a",
  schemaVersion: 1,
  termId: "pt-00000000000a",
  text: "synthetic",
});

const present = ({ bytesSha256 }: { bytesSha256: string }): PrivateTermsFileState => ({
  bytesSha256,
  kind: "present",
  text: "synthetic",
});

const ABSENT: PrivateTermsFileState = { kind: "absent" };

describe("privateTermsBaseSha256", () => {
  it("is the raw-bytes digest of a present file and null for an absent one", () => {
    expect(privateTermsBaseSha256({ state: present({ bytesSha256: "aa" }) })).toBe("aa");
    expect(privateTermsBaseSha256({ state: ABSENT })).toBeNull();
  });
});

describe("privateTermsProposalIsStale", () => {
  it("is current over a present file with the digest it recorded", () => {
    expect(
      privateTermsProposalIsStale({
        proposal: proposalOver({ baseSha256: "aa" }),
        state: present({ bytesSha256: "aa" }),
      }),
    ).toBe(false);
  });

  it("is stale over a present file whose digest moved", () => {
    expect(
      privateTermsProposalIsStale({
        proposal: proposalOver({ baseSha256: "aa" }),
        state: present({ bytesSha256: "bb" }),
      }),
    ).toBe(true);
  });

  it("is current when it was decided over no file and there is still none", () => {
    expect(privateTermsProposalIsStale({ proposal: proposalOver({ baseSha256: null }), state: ABSENT })).toBe(false);
  });

  it("is stale when it was decided over a file that is now gone", () => {
    expect(privateTermsProposalIsStale({ proposal: proposalOver({ baseSha256: "aa" }), state: ABSENT })).toBe(true);
  });

  it("is stale when it was decided over no file and one now exists", () => {
    expect(
      privateTermsProposalIsStale({
        proposal: proposalOver({ baseSha256: null }),
        state: present({ bytesSha256: "aa" }),
      }),
    ).toBe(true);
  });
});

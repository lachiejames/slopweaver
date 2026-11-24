/**
 * Retiring a waiting private-terms proposal over a throwaway home: it removes only that proposal, never writes the
 * terms file, takes the confirm lock, and a confirm and a retire of one proposal cannot both succeed — including the
 * case where the proposal disappears while confirm waits on a stale lock. Every term here is synthetic.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { confirmPrivateTermsProposal, retirePrivateTermsProposal } from "../../../hygiene/privateTermsStore.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { writePrivateTerms } from "../../privateTermsFixture.js";
import { seedPrivateTermsProposal } from "../../privateTermsProposalFixture.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "private-terms-store-"));
  homes.push(home);
  return home;
}

const notAlive = (): boolean => false;

describe("retirePrivateTermsProposal", () => {
  it("removes a current proposal and leaves the terms file byte for byte", () => {
    const home = freshHome();
    const termsPath = writePrivateTerms({ home, rows: ["person\ti\tinkwell\tsynthetic"] });
    const before = readFileSync(termsPath);
    const kept = seedPrivateTermsProposal({ home, proposalId: "pp-00000000000a", termId: "pt-00000000000a" });
    const retired = retirePrivateTermsProposal({ home, pidAlive: notAlive, proposalId: "pp-00000000000a" });
    expect(unwrap(retired)).toStrictEqual({
      action: "add",
      proposalId: "pp-00000000000a",
      stale: false,
      termId: "pt-00000000000a",
    });
    expect(existsSync(kept)).toBe(false);
    expect(readFileSync(termsPath)).toStrictEqual(before);
    expect(existsSync(`${termsPath}.lock`)).toBe(false);
  });

  it("reports a proposal stale once the terms file moved, and leaves the moved file untouched", () => {
    const home = freshHome();
    writePrivateTerms({ home });
    const kept = seedPrivateTermsProposal({
      action: "narrow",
      home,
      proposalId: "pp-00000000000b",
      termId: "pt-00000000000b",
    });
    const termsPath = writePrivateTerms({ home, rows: ["person\ti\tinkwell\tsynthetic"] });
    const moved = readFileSync(termsPath);
    const retired = retirePrivateTermsProposal({ home, pidAlive: notAlive, proposalId: "pp-00000000000b" });
    expect(unwrap(retired)).toStrictEqual({
      action: "narrow",
      proposalId: "pp-00000000000b",
      stale: true,
      termId: "pt-00000000000b",
    });
    expect(existsSync(kept)).toBe(false);
    expect(readFileSync(termsPath)).toStrictEqual(moved);
  });

  it("refuses a malformed id and an absent proposal, removing no other proposal", () => {
    const home = freshHome();
    writePrivateTerms({ home });
    const other = seedPrivateTermsProposal({ home, proposalId: "pp-00000000000c", termId: "pt-00000000000c" });
    const malformed = unwrapErr(retirePrivateTermsProposal({ home, pidAlive: notAlive, proposalId: "pp-NOTHEX" }));
    expect(malformed.code).toBe("PROPOSAL_UNUSABLE");
    expect(malformed.message).toBe(
      "no waiting proposal: a proposal id is pp- and twelve lowercase hex digits, as the read-back printed it",
    );
    const absent = unwrapErr(retirePrivateTermsProposal({ home, pidAlive: notAlive, proposalId: "pp-0000000000ff" }));
    expect(absent.code).toBe("PROPOSAL_UNUSABLE");
    expect(absent.message).toBe(
      "no waiting proposal: pp-0000000000ff is not waiting: it was confirmed or retired already, or never made under this home",
    );
    expect(existsSync(other)).toBe(true);
  });

  it("refuses while a live process holds the lock, keeping the proposal", () => {
    const home = freshHome();
    const termsPath = writePrivateTerms({ home });
    const kept = seedPrivateTermsProposal({ home, proposalId: "pp-00000000000d", termId: "pt-00000000000d" });
    writeFileSync(`${termsPath}.lock`, "4242\n");
    const held = unwrapErr(retirePrivateTermsProposal({ home, pidAlive: () => true, proposalId: "pp-00000000000d" }));
    expect(held.code).toBe("LOCK_HELD");
    expect(existsSync(kept)).toBe(true);
  });
});

describe("a confirm and a retire of one proposal", () => {
  it("refuses the confirm of a retired proposal, landing nothing", () => {
    const home = freshHome();
    const termsPath = writePrivateTerms({ home });
    const before = readFileSync(termsPath);
    seedPrivateTermsProposal({ home, proposalId: "pp-00000000000e", termId: "pt-00000000000e" });
    unwrap(retirePrivateTermsProposal({ home, pidAlive: notAlive, proposalId: "pp-00000000000e" }));
    const confirmed = unwrapErr(
      confirmPrivateTermsProposal({ home, pidAlive: notAlive, proposalId: "pp-00000000000e" }),
    );
    expect(confirmed.code).toBe("PROPOSAL_UNUSABLE");
    expect(readFileSync(termsPath)).toStrictEqual(before);
  });

  it("refuses the retire of a confirmed proposal", () => {
    const home = freshHome();
    writePrivateTerms({ home });
    seedPrivateTermsProposal({ home, proposalId: "pp-00000000000f", termId: "pt-00000000000f" });
    expect(unwrap(confirmPrivateTermsProposal({ home, pidAlive: notAlive, proposalId: "pp-00000000000f" })).rows).toBe(
      1,
    );
    const retired = unwrapErr(retirePrivateTermsProposal({ home, pidAlive: notAlive, proposalId: "pp-00000000000f" }));
    expect(retired.code).toBe("PROPOSAL_UNUSABLE");
  });

  it("re-reads the proposal under the lock, so one retired while confirm waited on a stale lock never lands", () => {
    const home = freshHome();
    const termsPath = writePrivateTerms({ home });
    const before = readFileSync(termsPath);
    const kept = seedPrivateTermsProposal({ home, proposalId: "pp-0000000000aa", termId: "pt-0000000000aa" });
    writeFileSync(`${termsPath}.lock`, "4242\n");
    // The liveness check runs after confirm's first read and before it takes the lock: the proposal is retired in
    // that window, exactly as another process holding the lock would have done.
    const retireWhileWaiting = (): boolean => {
      rmSync(kept);
      return false;
    };
    const confirmed = unwrapErr(
      confirmPrivateTermsProposal({ home, pidAlive: retireWhileWaiting, proposalId: "pp-0000000000aa" }),
    );
    expect(confirmed.code).toBe("PROPOSAL_UNUSABLE");
    expect(readFileSync(termsPath)).toStrictEqual(before);
    expect(existsSync(`${termsPath}.lock`)).toBe(false);
  });
});

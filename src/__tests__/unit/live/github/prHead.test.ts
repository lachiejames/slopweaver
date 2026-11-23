/**
 * The head read `handover park --wake-on-checks` takes: a node missing its state or head branch is a FAILED read,
 * never a blank branch that would read as somebody else's pull request.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parsePrHead } from "../../../../live/github/prHead.js";

const ID = "acme/widgets#3454";

describe("parsePrHead", () => {
  it("reads an open pull request's state and head branch", () => {
    const parsed = parsePrHead({
      data: { repository: { pullRequest: { headRefName: "fix-relay", state: "OPEN" } } },
      identity: ID,
    });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual({ headRefName: "fix-relay", state: "OPEN" });
  });

  it("reads the repository the head branch lives in, and leaves it out when GitHub names none", () => {
    const named = parsePrHead({
      data: {
        repository: {
          pullRequest: { headRefName: "fix-relay", headRepository: { nameWithOwner: "acme/fork" }, state: "MERGED" },
        },
      },
      identity: ID,
    });
    const deleted = parsePrHead({
      data: { repository: { pullRequest: { headRefName: "fix-relay", headRepository: null, state: "MERGED" } } },
      identity: ID,
    });
    expect([unwrap(named), unwrap(deleted)]).toEqual([
      { headRefName: "fix-relay", headRepository: "acme/fork", state: "MERGED" },
      { headRefName: "fix-relay", state: "MERGED" },
    ]);
  });

  it("reads the commit the head pointed at, and leaves it out when GitHub names none", () => {
    const oid = "0123456789abcdef0123456789abcdef01234567";
    const named = parsePrHead({
      data: { repository: { pullRequest: { headRefName: "fix-relay", headRefOid: oid, state: "MERGED" } } },
      identity: ID,
    });
    const absent = parsePrHead({
      data: { repository: { pullRequest: { headRefName: "fix-relay", headRefOid: null, state: "MERGED" } } },
      identity: ID,
    });
    expect([unwrap(named), unwrap(absent)]).toEqual([
      { headRefName: "fix-relay", headRefOid: oid, state: "MERGED" },
      { headRefName: "fix-relay", state: "MERGED" },
    ]);
  });

  it("refuses a pull request GitHub does not return", () => {
    const parsed = parsePrHead({ data: { repository: { pullRequest: null } }, identity: ID });
    expect(unwrapErr(parsed).code).toBe("NOT_FOUND");
  });

  it("refuses a blank head branch rather than reading it as another branch", () => {
    const parsed = parsePrHead({
      data: { repository: { pullRequest: { headRefName: "", state: "OPEN" } } },
      identity: ID,
    });
    expect(unwrapErr(parsed).message).toBe("GitHub returned acme/widgets#3454 with no head branch");
  });

  it("refuses a state it does not name", () => {
    const parsed = parsePrHead({
      data: { repository: { pullRequest: { headRefName: "fix-relay", state: "DRAFTY" } } },
      identity: ID,
    });
    expect(unwrapErr(parsed).message).toBe("GitHub returned acme/widgets#3454 with no state it names");
  });
});

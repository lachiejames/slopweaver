/**
 * The stack-membership ledger, tested against a real temp directory rather than a mocked filesystem —
 * same sanctioned exception as `prLedger.test.ts`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  isRegisteredStackMember,
  listRegisteredStackMembers,
  registerStackMember,
  stackMemberLocusOf,
  unregisterStackMember,
} from "../../../../outbound/github/stackLedger.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-stackledger-"));
  fixtureDirs.push(dir);
  return dir;
}

describe("stackMemberLocusOf", () => {
  it("lower-cases owner and repo, since GitHub treats them case-insensitively", () => {
    expect(stackMemberLocusOf({ number: 5, owner: "Owner", repo: "Repo" })).toBe("owner/repo#5");
    expect(stackMemberLocusOf({ number: 5, owner: "owner", repo: "repo" })).toBe(
      stackMemberLocusOf({ number: 5, owner: "Owner", repo: "Repo" }),
    );
  });

  it("distinguishes different PR numbers in the same repository", () => {
    expect(stackMemberLocusOf({ number: 5, owner: "o", repo: "r" })).not.toBe(
      stackMemberLocusOf({ number: 6, owner: "o", repo: "r" }),
    );
  });
});

describe("registerStackMember / isRegisteredStackMember", () => {
  it("is not registered before it is registered", () => {
    expect(isRegisteredStackMember({ home: home(), number: 100, owner: "o", repo: "r" })).toBe(false);
  });

  it("is registered immediately after registering", () => {
    const h = home();
    registerStackMember({ home: h, nowIso: "2026-08-11T00:00:00Z", number: 100, owner: "o", repo: "r", via: "push" });
    expect(isRegisteredStackMember({ home: h, number: 100, owner: "o", repo: "r" })).toBe(true);
  });

  it("is case-insensitive on owner/repo when checking registration", () => {
    const h = home();
    registerStackMember({
      home: h,
      nowIso: "2026-08-11T00:00:00Z",
      number: 100,
      owner: "Owner",
      repo: "Repo",
      via: "push",
    });
    expect(isRegisteredStackMember({ home: h, number: 100, owner: "owner", repo: "repo" })).toBe(true);
  });

  it("re-registering the same locus overwrites rather than refusing", () => {
    const h = home();
    registerStackMember({ home: h, nowIso: "2026-08-11T00:00:00Z", number: 100, owner: "o", repo: "r", via: "push" });
    expect(() =>
      registerStackMember({
        home: h,
        nowIso: "2026-08-11T01:00:00Z",
        number: 100,
        owner: "o",
        repo: "r",
        via: "adopt",
      }),
    ).not.toThrow();
    expect(isRegisteredStackMember({ home: h, number: 100, owner: "o", repo: "r" })).toBe(true);
  });

  it("does not register a different PR number in the same repo", () => {
    const h = home();
    registerStackMember({ home: h, nowIso: "2026-08-11T00:00:00Z", number: 100, owner: "o", repo: "r", via: "push" });
    expect(isRegisteredStackMember({ home: h, number: 101, owner: "o", repo: "r" })).toBe(false);
  });

  it("does not register the same PR number in a different repo", () => {
    const h = home();
    registerStackMember({ home: h, nowIso: "2026-08-11T00:00:00Z", number: 100, owner: "o", repo: "r", via: "push" });
    expect(isRegisteredStackMember({ home: h, number: 100, owner: "o", repo: "other" })).toBe(false);
  });
});

describe("unregisterStackMember", () => {
  it("is idempotent when nothing was ever registered", () => {
    expect(() => unregisterStackMember({ home: home(), number: 100, owner: "o", repo: "r" })).not.toThrow();
  });

  it("removes registration for exactly the named locus", () => {
    const h = home();
    registerStackMember({ home: h, nowIso: "2026-08-11T00:00:00Z", number: 100, owner: "o", repo: "r", via: "push" });
    registerStackMember({ home: h, nowIso: "2026-08-11T00:00:00Z", number: 101, owner: "o", repo: "r", via: "push" });
    unregisterStackMember({ home: h, number: 100, owner: "o", repo: "r" });
    expect(isRegisteredStackMember({ home: h, number: 100, owner: "o", repo: "r" })).toBe(false);
    expect(isRegisteredStackMember({ home: h, number: 101, owner: "o", repo: "r" })).toBe(true);
  });

  it("unregistering twice is a no-op the second time", () => {
    const h = home();
    registerStackMember({ home: h, nowIso: "2026-08-11T00:00:00Z", number: 100, owner: "o", repo: "r", via: "push" });
    unregisterStackMember({ home: h, number: 100, owner: "o", repo: "r" });
    expect(() => unregisterStackMember({ home: h, number: 100, owner: "o", repo: "r" })).not.toThrow();
  });
});

describe("listRegisteredStackMembers", () => {
  it("returns an empty list when nothing is registered", () => {
    expect(listRegisteredStackMembers({ home: home(), owner: "o", repo: "r" })).toEqual([]);
  });

  it("returns every registered number for one repository, sorted", () => {
    const h = home();
    registerStackMember({ home: h, nowIso: "2026-08-11T00:00:00Z", number: 300, owner: "o", repo: "r", via: "push" });
    registerStackMember({ home: h, nowIso: "2026-08-11T00:00:00Z", number: 100, owner: "o", repo: "r", via: "adopt" });
    registerStackMember({ home: h, nowIso: "2026-08-11T00:00:00Z", number: 200, owner: "o", repo: "r", via: "push" });
    expect(listRegisteredStackMembers({ home: h, owner: "o", repo: "r" })).toEqual([100, 200, 300]);
  });

  it("excludes members registered for a different repository", () => {
    const h = home();
    registerStackMember({ home: h, nowIso: "2026-08-11T00:00:00Z", number: 1, owner: "o", repo: "r", via: "push" });
    registerStackMember({ home: h, nowIso: "2026-08-11T00:00:00Z", number: 2, owner: "o", repo: "other", via: "push" });
    expect(listRegisteredStackMembers({ home: h, owner: "o", repo: "r" })).toEqual([1]);
  });
});

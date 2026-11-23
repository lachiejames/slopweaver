/*
 * What the page is not showing, and why: a list partial by the identity it was asked as, every login this machine
 * is logged in as, and the omission line that says how many rows were withheld.
 */
import { describe, expect, it } from "vitest";
import type { PrRepo } from "../../../../../pane/sections/prStatusDecode.js";
import {
  identityGap,
  identityGapNotes,
  omissionLine,
  parseGhAccounts,
} from "../../../../../pane/sections/prStatusIdentity.js";

describe("identityGap — the list that is PARTIAL by identity, not empty", () => {
  /** One watched repository, spread over so only the field under test varies. */
  function repo({ tokenUser }: { tokenUser: string | undefined }): PrRepo {
    return { nameWithOwner: "slopweaver/slopweaver", tokenUser };
  }

  // The live shape measured: four open, three by the work login, one by the personal one.
  const OPEN = [
    { author: "work-login", number: 207 },
    { author: "work-login", number: 206 },
    { author: "work-login", number: 205 },
    { author: "personal-login", number: 204 },
  ];

  it("finds the owner's OWN pull request that a partial list dropped", () => {
    const gaps = identityGap({
      accounts: ["work-login", "personal-login"],
      open: OPEN,
      shown: [207, 206, 205],
    });

    expect(gaps).toEqual([{ login: "personal-login", numbers: [204] }]);
  });

  it("fires even though three rows DID come back — the old zero-rows guard missed exactly this", () => {
    expect(
      identityGap({ accounts: ["work-login", "personal-login"], open: OPEN, shown: [207, 206, 205] }),
    ).toHaveLength(1);
  });

  it("finds the mirror case — asked as the personal login, the work login's three go missing", () => {
    const gaps = identityGap({ accounts: ["work-login", "personal-login"], open: OPEN, shown: [204] });

    expect(gaps).toEqual([{ login: "work-login", numbers: [207, 206, 205] }]);
  });

  it("ignores a colleague's pull request — that is a scope decision, not an identity fault", () => {
    expect(identityGap({ accounts: ["work-login"], open: [{ author: "a-colleague", number: 9 }], shown: [] })).toEqual(
      [],
    );
  });

  it("finds nothing when every open pull request is already on the page", () => {
    expect(identityGap({ accounts: ["work-login"], open: OPEN, shown: [207, 206, 205, 204] })).toEqual([]);
  });

  it("sorts by login so the note does not reshuffle between measurements", () => {
    const gaps = identityGap({
      accounts: ["zed", "alice"],
      open: [
        { author: "zed", number: 2 },
        { author: "alice", number: 1 },
      ],
      shown: [],
    });

    expect(gaps.map((gap) => gap.login)).toEqual(["alice", "zed"]);
  });

  it("names the login, the numbers and the exact flag that fixes it", () => {
    const notes = identityGapNotes({
      gaps: [{ login: "personal-login", numbers: [204] }],
      repo: repo({ tokenUser: "work-login" }),
    });

    expect(notes).toHaveLength(1);
    expect(notes[0]!).toContain("opened by @personal-login — an account THIS MACHINE IS LOGGED IN AS");
    expect(notes[0]!).toContain("Missing: #204");
    expect(notes[0]!).toContain("PARTIAL BY IDENTITY, not by fact");
    expect(notes[0]!).toContain("--pr-repos slopweaver/slopweaver@personal-login");
  });

  it("says which identity the rows WERE asked as, including the ambient one", () => {
    const notes = identityGapNotes({
      gaps: [{ login: "personal-login", numbers: [204] }],
      repo: repo({ tokenUser: undefined }),
    });

    expect(notes[0]!).toContain("asked as the ambient account");
  });
});

describe("parseGhAccounts — every login this machine is logged in as", () => {
  it("reads both logins out of a real `gh auth status`", () => {
    const stdout = [
      "github.com",
      "  ✓ Logged in to github.com account work-login (keyring)",
      "  - Active account: true",
      "  ✓ Logged in to github.com account personal-login (keyring)",
      "  - Active account: false",
    ].join("\n");

    expect(parseGhAccounts({ stdout })).toEqual(["work-login", "personal-login"]);
  });

  it("reads none from output that names none", () => {
    expect(parseGhAccounts({ stdout: "You are not logged into any GitHub hosts." })).toEqual([]);
  });
});

describe("omissionLine — what the page is NOT showing, as a number", () => {
  it("names the account, the open total, the rows shown and the rows withheld", () => {
    const line = omissionLine({
      watched: [
        { mine: 7, nameWithOwner: "o/work", openTotal: { known: true, value: 266 }, tokenUser: "a-work-login" },
        { mine: 1, nameWithOwner: "o/personal", openTotal: { known: true, value: 1 }, tokenUser: "a-personal-login" },
      ],
    });

    expect(line).toBe(
      "Watching 2 repo(s) — o/work (as @a-work-login): 266 open, 7 yours, 259 not on this page; " +
        "o/personal (as @a-personal-login): 1 open, 1 yours, 0 not on this page.",
    );
  });

  it("says the ambient account was inherited when no account was named", () => {
    const line = omissionLine({
      watched: [{ mine: 0, nameWithOwner: "o/r", openTotal: { known: true, value: 3 }, tokenUser: undefined }],
    });

    expect(line).toContain("as the ambient gh account");
  });

  it("says the total was NOT measured rather than implying nothing is being withheld", () => {
    const line = omissionLine({
      watched: [{ mine: 2, nameWithOwner: "o/r", openTotal: { known: false, why: "gh timed out" }, tokenUser: "a" }],
    });

    expect(line).toContain("how many are open in TOTAL was NOT measured — gh timed out");
    expect(line).not.toContain("not on this page");
  });
});

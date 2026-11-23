import { describe, expect, it } from "vitest";

import {
  bareRefs,
  MAX_REF_DIGITS,
  type RefResolution,
  repoSlugFor,
  settledRefsReason,
  staleRefReason,
} from "../../../sessionStart/staleRefs.js";
import { ACME_ORGANISATION, FIXTURE_SELF_REPOSITORY, GLOBEX_ORGANISATION } from "../../organisationFixture.js";

describe("bareRefs", () => {
  it("finds a bare reference in ordinary prose", () => {
    expect(bareRefs({ text: "PR #505 is a green draft." })).toStrictEqual([505]);
  });

  it("finds one at the very start of the text", () => {
    expect(bareRefs({ text: "#458 needs a look" })).toStrictEqual([458]);
  });

  it("finds several, deduplicated, in first-seen order", () => {
    expect(bareRefs({ text: "#505 then #499 then #505 again" })).toStrictEqual([505, 499]);
  });

  it("finds one after a bracket or a comma, which is how they are usually written", () => {
    expect(bareRefs({ text: "landed (#115, #107)" })).toStrictEqual([115, 107]);
  });

  it("IGNORES a fully-qualified reference, which names its own repository", () => {
    expect(bareRefs({ text: "see acme/acme-admin#16341 for the fix" })).toStrictEqual([]);
  });

  it("ignores a number that is part of a larger token", () => {
    expect(bareRefs({ text: "the id is #12ab" })).toStrictEqual([]);
  });

  it("ignores a six-digit hex colour, which is the case that proved the digit bound", () => {
    expect(bareRefs({ text: "the colour is #505050 and the accent is #0d6b64" })).toStrictEqual([]);
  });

  it("still finds the five-digit numbers acme-admin actually uses", () => {
    expect(bareRefs({ text: "blocked on #16367" })).toStrictEqual([16367]);
  });

  it("ignores a ticket identifier that happens to contain a hash", () => {
    expect(bareRefs({ text: "SUP-1#2 is not a pull request" })).toStrictEqual([]);
  });

  it("finds nothing in text with no references", () => {
    expect(bareRefs({ text: "answer the recorded question" })).toStrictEqual([]);
  });
});

describe("MAX_REF_DIGITS", () => {
  it("covers the highest number either repository actually uses", () => {
    expect(MAX_REF_DIGITS).toBe(5);
  });
});

describe("repoSlugFor", () => {
  const organisation = ACME_ORGANISATION;

  it("maps a checkout path to the organisation repository its references belong to", () => {
    expect(repoSlugFor({ organisation, repoPath: "/repos/dev/acme-admin" })).toBe("acme/acme-admin");
  });

  it("reads the organisation's repositories rather than a constant, so another organisation maps its own", () => {
    expect([
      repoSlugFor({ organisation: GLOBEX_ORGANISATION, repoPath: "/repos/dev/web" }),
      repoSlugFor({ organisation: GLOBEX_ORGANISATION, repoPath: "/repos/dev/acme-admin" }),
    ]).toEqual(["globex/web", undefined]);
  });

  it("maps this build's own repository too, so an acme-admin number is never checked against slopweaver", () => {
    expect(repoSlugFor({ organisation, repoPath: "/repos/dev/personal/slopweaver" })).toBe(FIXTURE_SELF_REPOSITORY);
  });

  it("keys on the directory name, so a worktree resolves the same as its main checkout", () => {
    expect(repoSlugFor({ organisation, repoPath: "/tmp/whatever/nested/slopweaver/" })).toBe(FIXTURE_SELF_REPOSITORY);
  });

  it("names nothing for a basename two organisation repositories share, rather than guessing an owner", () => {
    const twoWebs = { ...GLOBEX_ORGANISATION, repositories: ["globex/web", "globex-labs/web"] };
    expect(repoSlugFor({ organisation: twoWebs, repoPath: "/repos/dev/web" })).toBeUndefined();
  });

  it("names nothing for a path it does not know, rather than guessing an owner", () => {
    expect(repoSlugFor({ organisation, repoPath: "/repos/dev/some-other-thing" })).toBeUndefined();
  });

  it("names nothing when the doc named no repository at all", () => {
    expect(repoSlugFor({ organisation, repoPath: undefined })).toBeUndefined();
  });

  it("takes an owner/name slug as itself rather than through the basename lookup", () => {
    expect(repoSlugFor({ organisation, repoPath: "acme/acme-admin" })).toBe("acme/acme-admin");
  });

  it("never re-points a foreign org's repository at the organisation's entry of the same name", () => {
    expect(repoSlugFor({ organisation, repoPath: "someone-else/acme-admin" })).toBe("someone-else/acme-admin");
  });

  it("names nothing for a slug-shaped value with an empty segment", () => {
    expect(repoSlugFor({ organisation, repoPath: "acme/" })).toBeUndefined();
  });

  it("reads a three-segment value as a path, so only a two-segment one is a slug", () => {
    expect(repoSlugFor({ organisation, repoPath: "some/nested/acme-admin" })).toBe("acme/acme-admin");
  });
});

describe("staleRefReason", () => {
  const repo = "lachiejames/slopweaver";

  it("names the number AND the repository, because the number was real somewhere else", () => {
    const resolutions: readonly RefResolution[] = [{ number: 505, verdict: "unknown-to-canonical" }];
    expect(staleRefReason({ repo, resolutions })).toBe(
      "#505 does not exist in lachiejames/slopweaver, so this row was written against an older repository and its numbers do not mean what they say",
    );
  });

  it("lists every unresolvable reference and agrees with itself grammatically", () => {
    const resolutions: readonly RefResolution[] = [
      { number: 505, verdict: "unknown-to-canonical" },
      { number: 458, verdict: "unknown-to-canonical" },
    ];
    expect(staleRefReason({ repo, resolutions })).toBe(
      "#505, #458 do not exist in lachiejames/slopweaver, so this row was written against an older repository and its numbers do not mean what they say",
    );
  });

  it("says nothing when every reference resolved", () => {
    expect(staleRefReason({ repo, resolutions: [{ number: 138, verdict: "resolved" }] })).toBeUndefined();
  });

  it("says nothing when a reference was never checked, because unchecked is not missing", () => {
    expect(staleRefReason({ repo, resolutions: [{ number: 505, verdict: "not-checked" }] })).toBeUndefined();
  });

  it("says nothing when there were no references at all", () => {
    expect(staleRefReason({ repo, resolutions: [] })).toBeUndefined();
  });
});

describe("settledRefsReason", () => {
  const repo = "acme/acme-admin";

  it("names the state the provider gave, because MERGED and CLOSED are different facts to the owner", () => {
    const resolutions: readonly RefResolution[] = [{ number: 16_349, state: "MERGED", verdict: "settled" }];
    expect(settledRefsReason({ repo, resolutions })).toBe(
      "#16349 is MERGED in acme/acme-admin, so the pull request this row asks about is already finished",
    );
  });

  it("agrees with itself grammatically over several references", () => {
    const resolutions: readonly RefResolution[] = [
      { number: 16_349, state: "MERGED", verdict: "settled" },
      { number: 16_497, state: "CLOSED", verdict: "settled" },
    ];
    expect(settledRefsReason({ repo, resolutions })).toBe(
      "#16349 is MERGED, #16497 is CLOSED in acme/acme-admin, so every pull request this row asks about is already finished",
    );
  });

  it("says nothing when one reference is still open, because the question is still live", () => {
    const resolutions: readonly RefResolution[] = [
      { number: 16_349, state: "MERGED", verdict: "settled" },
      { number: 16_350, verdict: "resolved" },
    ];
    expect(settledRefsReason({ repo, resolutions })).toBeUndefined();
  });

  it("says nothing when a reference was never read, because unread is not done", () => {
    const resolutions: readonly RefResolution[] = [
      { number: 16_349, state: "MERGED", verdict: "settled" },
      { number: 16_350, verdict: "not-checked" },
    ];
    expect(settledRefsReason({ repo, resolutions })).toBeUndefined();
  });

  it("says nothing alongside a reference the repository does not know", () => {
    const resolutions: readonly RefResolution[] = [
      { number: 16_349, state: "MERGED", verdict: "settled" },
      { number: 505, verdict: "unknown-to-canonical" },
    ];
    expect(settledRefsReason({ repo, resolutions })).toBeUndefined();
  });

  it("says nothing when there were no references at all", () => {
    expect(settledRefsReason({ repo, resolutions: [] })).toBeUndefined();
  });

  it("falls back to a plain word when a settled reference carried no state", () => {
    expect(settledRefsReason({ repo, resolutions: [{ number: 12, verdict: "settled" }] })).toBe(
      "#12 is settled in acme/acme-admin, so the pull request this row asks about is already finished",
    );
  });
});
